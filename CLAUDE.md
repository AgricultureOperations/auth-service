# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Auth Service is the authentication/authorization microservice of the AgricultureOperations platform. It registers users, logs them in, issues JWTs that carry the user's role and permissions, and manages users, roles and permissions (RBAC). It uses Express 5, TypeScript (strict, CommonJS), SQLite via `better-sqlite3`, bcrypt, and JWT.

## Architectural Pattern: Express Layered Architecture

Requests flow in one direction only: `routes → controllers → services → repositories → SQLite`. Each layer calls only the layer directly below it.

- There is no DI. Controllers create services at module level, and services create repositories as class fields.
- Wrap controllers in `asyncHandler`. Throw `AppError(message, statusCode)` from services (or from the `utils/validation.ts` helpers in controllers) to return a specific status. `errorMiddleware` maps malformed JSON to 400 and any other error to 500.
- Controllers validate input with `utils/validation.ts`: every `:id` param and every id in a body must be a UUID v4 (400 otherwise), and `requireBody(body, allowedFields)` rejects unknown fields with 400.
- Multi-step writes that check a rule first (last-admin guard, role permission replace) run in `inTransaction` (`repositories/transaction.ts`).
- Responses never contain `password`. Repositories select explicit columns; only `UserRepository.findByEmail` (login) reads the hash.

## Authentication and authorization

- `authMiddleware` (`middlewares/auth.middleware.ts`) returns **401** `{ status, message }` for: missing header or non-`Bearer` scheme, bad signature, expired token, wrong issuer/audience, unknown or inactive user, or a `tv` claim that doesn't match `users.token_version`. It re-reads the user's role and permissions from the DB and stores them on `res.locals.auth` (`getAuth(resp)`).
- `requirePermission("users:edit")` / `requireRole("admin")` (`middlewares/permission.middleware.ts`) run after it and return **403** `{ status, message }`. 401 makes the dashboard log out; 403 doesn't, so never return 401 for "not allowed".
- JWT payload: `{ sub, id, email, role, permissions, tv }` (`utils/jwt.ts` `TokenClaims`), HS256 with `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`. `id` duplicates `sub` for old consumers. Other services read these claims; see `docs/rbac-handoff.md`.
- `token_version` is bumped when a user's role changes, when the user is deactivated, and for every holder of a role whose permissions change (`PUT /roles/:id/permissions`). That makes their existing tokens 401 immediately.

## RBAC model

| Table | Notes |
|---|---|
| `actions` | `view`, `create`, `edit`, `delete` |
| `resources` | `products`, `orders`, `users`, `roles`, `customers`, `settings` (`sort_order` 10, 20, …) |
| `permissions` | one per resource × action, `code` = `"<resource>:<action>"` |
| `roles` | `key` (slug, immutable, used in the JWT), `name`, `description`, `is_system`, `is_active` |
| `role_permissions` | `granted_at`, `granted_by` (user, `SET NULL` on delete) |
| `users` | `name`, `role_id` (one role per user, `RESTRICT`), `is_active`, `token_version`, `created_at`, `updated_at`, `last_login_at`, `tax_id` (cédula/RUC, upper-cased, unique when set), `phone` (both `003_customer_fields`, used by customers) |

All ids are UUID v4 text (`crypto.randomUUID()`), and all timestamps are ISO 8601 UTC text.

System roles: `admin` (every permission, always), `operator` (view/create/edit on products, orders and customers), `viewer` (view on products, orders and customers), `customer` (no permissions: buyers referenced by order-service orders). `settings:*` belongs to admin only by default. Guardrails (409):
- Nobody can demote, deactivate or delete the last active admin.
- The admin role's permissions can't be reduced.
- System roles can't be deleted or deactivated.
- A role that still has users can't be deleted or deactivated.

**Public registration (`POST /auth/register`) always creates a `customer`** (the customer portal's signup). It reads only `email`, `password` (≥ 8), `name?`, `taxId?` and `phone?`, ignores anything else (a role in the body has no effect), and answers 409 for a duplicate email or tax ID. Staff accounts are created by an admin through `/user`. `/auth/login` and `/auth/register` are rate limited (`middlewares/rate-limit.middleware.ts`, 429 `{ status, message }`, skipped under `NODE_ENV=test`).

### Endpoints (all under `/api/v1`)

| Method | Path | Permission |
|---|---|---|
| POST | `/auth/register` `{ email, password, name?, taxId?, phone? }` → `201 { id, email }` (customer); `/auth/login` → `{ token }` | public, rate limited |
| GET | `/auth/me` | authenticated |
| GET | `/user?search=&roleId=&isActive=&page=&pageSize=` → `{ data, meta: { page, pageSize, total, totalPages } }`, `/user/:id` | `users:view` |
| POST | `/user` `{ name, email, password (≥ 8), roleId }` | `users:create` |
| PATCH | `/user/:id` `{ name }` (email is immutable), `/user/:id/role` `{ roleId }`, `/user/:id/status` `{ isActive }` | `users:edit` |
| DELETE | `/user/:id` | `users:delete` |
| GET | `/roles?search=&isActive=`, `/roles/:id` (with `userCount`, `permissionIds`) | `roles:view` |
| POST | `/roles` `{ name, key?, description? }` (`key` defaults to the slugified name) | `roles:create` |
| PATCH | `/roles/:id` `{ name?, description?, isActive? }` | `roles:edit` |
| PUT | `/roles/:id/permissions` `{ permissionIds: uuid[] }` | `roles:edit` |
| DELETE | `/roles/:id` | `roles:delete` |
| GET | `/permissions` → `{ actions, resources: [{ …, permissions }] }` (matrix-ready) | `roles:view` |
| GET | `/customers?search=&isActive=&page=&pageSize=` (search on name, email, tax ID) → `{ data: CustomerDto[], meta }`, `/customers/:id` | `customers:view` |
| POST | `/customers` `{ name, email, taxId?, phone? }` → 201 `CustomerDto` (role `customer`, random unusable password; 409 on a duplicate email or tax ID) | `customers:create` |
| PATCH | `/customers/:id` `{ name?, taxId?, phone? }` (`null` clears; email is immutable; a non-customer id is 404) | `customers:edit` |

`CustomerDto` = `{ id, name, email, taxId, phone, isActive, createdAt, updatedAt }`. Deactivating or deleting a customer goes through `/user` (`users:edit|delete`). `UserDto` also carries `taxId` and `phone` (null for back-office users), and `/user?search=` matches tax IDs too.

A new protected resource needs: a `RESOURCES` entry in `data/seed.ts` (admin picks up its permissions on the next start), a router mounted behind `authMiddleware` in `app.ts`, and `requirePermission` on each route.

## Migrations and seed

- **Migrations never run on startup. They are applied only by the command `scripts/migration.js`** (Laravel-style). `src/data/database.ts` opens `<cwd>/data/$DB_FILE` (`foreign_keys = ON`, `busy_timeout = 5000`) and checks for pending migrations without writing: if any are pending, the server still starts (so a Render Shell can reach it) but logs them and skips the seed, and requests that need the missing schema fail until someone migrates. Otherwise it runs `seed(db, …)`. `GET /api/v1/health` (public) returns `{ status: "ok" | "migrations_pending", pendingMigrations: <count> }`.
- Migrations are plain SQL files in `migrations/` (service root, not `src/`), named `NNN_snake_case.sql`; the id is the file name without `.sql`. The Dockerfile copies `migrations/` and `scripts/` into the image. `src/data/migrator.ts` is the engine; `src/cli/migration.ts` is the command; `scripts/migration.js` is the executable launcher (ts-node on `src/` in a checkout, `dist/cli/migration.js` in the image).
- Commands (from any folder; `--help` lists them):
  ```bash
  APP_ENV=DEV auth-service/scripts/migration.js status            # every migration: applied (batch, user, date, env) or pending
  APP_ENV=DEV auth-service/scripts/migration.js up                # apply all pending (one batch), then run the seed
  APP_ENV=DEV auth-service/scripts/migration.js auth-service/migrations/004_x.sql   # only that file (must be the next pending one)
  APP_ENV=DEV auth-service/scripts/migration.js history           # every attempt, including failed ones
  APP_ENV=DEV auth-service/scripts/migration.js verify            # exit 1 if an applied file changed or is missing
  auth-service/scripts/migration.js make add_user_locale          # create migrations/NNN_add_user_locale.sql
  npm run migrate | migrate:status | migrate:history | migrate:make -- <name>   # same, from auth-service/
  ```
  `APP_ENV` = `DEV` (loads `.env`), `TEST` (`.env.test`) or `PROD` (`.env.production` if present); the default is `PROD` when `NODE_ENV=production` (the image), otherwise `DEV`. Shell variables win over the file. Needs Node 24 on `PATH` (`nvm use`, which reads `.nvmrc`), like the rest of the service; on another version the launcher prints how to switch instead of a stack trace.
- **History:** every run is recorded in `migration_history` (`migration`, `checksum` (sha256 of the file), `batch`, `status` `applied|failed`, `applied_by`, `app_env`, `hostname`, `started_at`, `finished_at`, `duration_ms`, `backup_file`, `error`). The user is `--user`, else `MIGRATION_USER`, else `git config user.email`, else `<os user>@<host>`. A failed attempt is rolled back, recorded as `failed` and doesn't count as applied.
- **Safeguards:** `up` with `APP_ENV=PROD` needs `--yes` and an explicit user (`--user` or `MIGRATION_USER`), and can't use `--no-backup`. Before applying, `up` copies the database with `VACUUM INTO` to `data/backups/<UTC timestamp>-before-<first id>.db` (on the volume): that copy is the rollback, since there are no down migrations. A single file can't skip earlier pending migrations or re-run an applied one. The seed runs after `up` only when nothing is left pending (`--no-seed` skips it).
- Each migration runs in its own transaction with foreign keys off, and must leave `PRAGMA foreign_key_check` clean. This allows the SQLite rebuild pattern: create the new table, copy the rows, drop the old table, rename. Don't write `BEGIN`/`COMMIT` in a file.
- **Never edit, rename or reorder a migration that has been applied anywhere. Add a new one.** `status` marks an edited file `changed` and a deleted one `missing`; `verify` fails on either. It must run on an empty DB and on the Render/compose volume, and stay additive (the previous image may still be running).
- **Legacy:** before 2026-11, migrations were TypeScript modules run on startup and recorded only in `schema_migrations (id, applied_at)`. `001`–`003` were converted to SQL with the same ids and the same resulting schema (verified against the old runner). On such a database the server and `status` treat the `schema_migrations` ids as applied, and the first `up` copies them into `migration_history` as batch 0 (`applied_by = legacy:schema_migrations`). `schema_migrations` is left in place for an older image; nothing writes to it any more.
- Tests: `test/global-setup.ts` (Jest `globalSetup`) migrates the shared test DB once through the same engine (user `jest`, no backup). `test/unit/migrator.test.ts` and `migration-cli.test.ts` use their own temp folders.
- `002_rbac` rebuilt `users` and backfilled existing users with `viewer` and `name` = the email's local part.
- `003_customer_fields` adds nullable `users.tax_id` and `users.phone`, plus a partial unique index on `tax_id`.
- `seed.ts` is idempotent and matches rows by key/name, never by id. It upserts actions and resources, creates any missing `resource:action` permissions and system roles, and re-grants admin every permission.
- Default grants for `operator`/`viewer` are applied once, recorded in `seed_history`, so an admin's later edits survive restarts.
- Grants added after a role already exists go in `GRANT_SETS` (e.g. `grants:customers-v1`). Each set is applied once under its own `seed_history` key, so it reaches existing Render/compose databases and an admin can still revoke it. Append a new set; never edit one that has shipped.
- The first admin is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` only if no user has that email; an existing account is never changed.
- Without an admin, nobody can open `/users` or `/roles` in the dashboard (only `admin` has `users:*`/`roles:*`). To promote an existing account, update its `role_id` to the `admin` role and bump `token_version` by hand. `docs/rbac-deployment.md` has the query, a `docker compose exec … node -e` version (the runtime image has no `sqlite3`), verification queries and the rollback steps. Apply schema changes with `scripts/migration.js`, never with hand-written SQL in a shell, so they are recorded in `migration_history`.

## Key Folder Responsibilities

| Path | Responsibility |
|---|---|
| `src/app.ts` | Builds the Express app (JSON, CORS, routes, error middleware) without listening; tests import it |
| `src/server.ts` | Entry point: loads `.env` and calls `listen` on `PORT` |
| `src/routes/` | `auth`, `user`, `role`, `permission`, `customer` routers; `requirePermission` per route |
| `src/controllers/` | HTTP layer: validates `req` (`utils/validation.ts`) and sends the status and JSON response |
| `src/services/` | Business logic and guardrails (`AppError`) |
| `src/repositories/` | Data access with synchronous prepared statements, plus `inTransaction` |
| `src/models/` | Row types, DTOs and `to*Dto` mappers |
| `src/middlewares/` | `authMiddleware` (401), `requirePermission`/`requireRole` (403), `loginRateLimit`/`registerRateLimit` (429), error handler |
| `src/utils/` | `jwt.ts` (sign/verify with iss/aud/HS256), `validation.ts`, `AppError`, `asyncHandler` |
| `src/data/` | `database.ts` (connection, pending check, seed), `migrator.ts` (migration engine), `seed.ts` |
| `src/cli/migration.ts` | The migration command (`status`, `up`, `history`, `verify`, `make`) |
| `migrations/` | SQL migrations `NNN_snake_case.sql`, applied by command only |
| `scripts/migration.js` | Executable launcher for the command (works from any folder) |
| `test/helpers/db.ts` | `resetDb()`, `userWithRole(key)`, `adminToken()`, `bearer()`, `roleId()` |
| `test/unit` | Service, migrator, migration command and seed tests (the last three use their own temp DB files) |
| `test/integration`, `test/e2e` | HTTP tests that drive `app` with Supertest (`rbac.*.e2e.test.ts` cover every endpoint for 401/403/2xx; `rbac.customers.e2e.test.ts` covers `/customers` and the `settings:*` grants; `register.e2e.test.ts` covers customer self-registration and the CORS origin list) |
| `docs/rbac-handoff.md` | Contract notes for order-service/product-service (Phase 2) and the dashboard (Phase 3) |
| `docs/rbac-deployment.md` | Deploying `002_rbac` to another environment: backup, first admin, manual SQL, admin promotion, verification, rollback |

## Build & Run Commands

```bash
npm install
npm run dev      # ts-node-dev with watch mode on src/server.ts
npm run build    # tsc: src/ -> dist/ (test/ is excluded)
npm start        # node dist/server.js
npm run migrate  # apply pending migrations + seed (APP_ENV=DEV by default); see "Migrations and seed"

docker build -t auth-service .
docker run --env-file .env -d -p 3000:3000 auth-service
```

The project has no lint script. Use Node 24 (CI's version, pinned in `.nvmrc`). `better-sqlite3` is a native module, and `node_modules` built on another major version fails to load (`NODE_MODULE_VERSION`).

## Test Commands

```bash
npm test                                   # jest --runInBand (serial, required)
npx jest test/e2e/rbac.users.e2e.test.ts   # single file
npx jest -t "last active admin"            # by test name
```

- `jest.setup.ts` loads `.env.test` first, and the later `dotenv.config()` in `jwt.ts` does not override those values. It also defaults `ADMIN_EMAIL`/`ADMIN_PASSWORD` to test-only values when they're unset.
- `test/global-setup.ts` migrates that file once before the suites run (the server no longer does).
- The HTTP tests use a real SQLite file (`data/$DB_FILE`) with nothing mocked. Each suite calls `resetDb()` in `beforeEach`, which deletes users and custom roles and re-seeds. That shared file is why tests must run serially.
- **Known flakiness:** about one full run in six fails a random HTTP test with `socket hang up` (Supertest connection error, not an assertion); the same file passes alone. Rerun before debugging.
- `.env.test` is gitignored, so CI runs without it: JWT variables come from GitHub secrets and `DB_FILE` falls back to `database.db`.

## Environment

Variables are listed in `.env.example`:
- `PORT`
- `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_TIMEEXP`
- `DB_FILE`
- `FRONTEND_URL`: the allowed CORS origins, **comma-separated** (`allowedOrigins()` in `app.ts`): the internal dashboard and the customer portal. Defaults to `http://localhost:5173,http://localhost:3100`; on Render set `https://agricultureops.netlify.app,<portal URL>`.
- `LOGIN_RATE_LIMIT` (default 20) and `REGISTER_RATE_LIMIT` (default 10): requests per client IP per 15 minutes on the public auth endpoints. `app.set("trust proxy", 1)` reads the client IP behind Render's proxy.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: the first admin. Optional once an admin exists.

`jwt.ts` reads the JWT variables once, at module load. CORS allows `GET`, `POST`, `PUT`, `PATCH` and `DELETE`.

`.env*` files (except `.env.example`) and `*.db` files are ignored by git and excluded from the Docker build context.

## Docker & CI/CD

- **Dockerfile**: a multi-stage build on `node:20-alpine`. The builder stage installs `python3`, `make` and `g++` for the native modules (`bcrypt`, `better-sqlite3`) and runs `npm run build`. The runtime stage runs `npm ci --omit=dev`, copies `dist/`, runs as the `node` user, uses `/app/data` for the database, and exposes port 3000.
- **`.dockerignore`**: excludes `test/`, `dist`, `node_modules`, `.env*` and `*.db`, so the image never contains secrets or local databases.
- **CI/CD** (`.github/workflows/ci-cd.yml`): runs on pushes to `main` (including changes under `migrations/` and `scripts/`). The pipeline runs `npm test` on Node 24, then pushes the image to Docker Hub (`etcruz/auth-service`), then triggers the Render deploy hook. On Render, set `ADMIN_EMAIL`/`ADMIN_PASSWORD` before the first RBAC deploy, or no one will be able to manage users and roles.
- **Deploying a migration:** the deploy doesn't migrate. After Render (or compose) runs the new image, open the service's Shell and run `node scripts/migration.js status`, then `node scripts/migration.js up --user <your email> --yes`, and check `GET /api/v1/health` says `ok`. Locally with compose: `docker compose exec auth-service node scripts/migration.js up --user "$(git config user.email)"` (compose sets `APP_ENV=DEV`).
