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

- `src/data/database.ts` opens `<cwd>/data/$DB_FILE`, sets `PRAGMA foreign_keys = ON`, runs `runMigrations(db)` and then `seed(db, …)` at module load. The server and the tests both go through this.
- Migrations are TypeScript modules in `src/data/migrations/`, listed in order in `migrations/index.ts`. They're compiled into `dist/`, since the Dockerfile only copies `src/`. Applied ids are recorded in `schema_migrations`.
- Each migration runs in its own transaction with foreign keys off, and must leave `PRAGMA foreign_key_check` clean. This allows the SQLite rebuild pattern: create the new table, copy the rows, drop the old table, rename.
- **Never edit or reorder a migration that has shipped. Add a new one.** It must run on an empty DB and on the Render/compose volume.
- `002_rbac` rebuilt `users` and backfilled existing users with `viewer` and `name` = the email's local part.
- `003_customer_fields` adds nullable `users.tax_id` and `users.phone`, plus a partial unique index on `tax_id`.
- `seed.ts` is idempotent and matches rows by key/name, never by id. It upserts actions and resources, creates any missing `resource:action` permissions and system roles, and re-grants admin every permission.
- Default grants for `operator`/`viewer` are applied once, recorded in `seed_history`, so an admin's later edits survive restarts.
- Grants added after a role already exists go in `GRANT_SETS` (e.g. `grants:customers-v1`). Each set is applied once under its own `seed_history` key, so it reaches existing Render/compose databases and an admin can still revoke it. Append a new set; never edit one that has shipped.
- The first admin is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` only if no user has that email; an existing account is never changed.
- Without an admin, nobody can open `/users` or `/roles` in the dashboard (only `admin` has `users:*`/`roles:*`). To promote an existing account, update its `role_id` to the `admin` role and bump `token_version` by hand. `docs/rbac-deployment.md` has the query, a `docker compose exec … node -e` version (the runtime image has no `sqlite3`), a manual SQL equivalent of `002_rbac` + seed, verification queries and the rollback steps. A hand-applied migration must also insert its id into `schema_migrations`, or the next startup runs it again and fails.

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
| `src/data/` | `database.ts`, `migrate.ts`, `migrations/`, `seed.ts` |
| `test/helpers/db.ts` | `resetDb()`, `userWithRole(key)`, `adminToken()`, `bearer()`, `roleId()` |
| `test/unit` | Service, migration and seed tests (the last two use their own temp DB files) |
| `test/integration`, `test/e2e` | HTTP tests that drive `app` with Supertest (`rbac.*.e2e.test.ts` cover every endpoint for 401/403/2xx; `rbac.customers.e2e.test.ts` covers `/customers` and the `settings:*` grants; `register.e2e.test.ts` covers customer self-registration and the CORS origin list) |
| `docs/rbac-handoff.md` | Contract notes for order-service/product-service (Phase 2) and the dashboard (Phase 3) |
| `docs/rbac-deployment.md` | Deploying `002_rbac` to another environment: backup, first admin, manual SQL, admin promotion, verification, rollback |

## Build & Run Commands

```bash
npm install
npm run dev      # ts-node-dev with watch mode on src/server.ts
npm run build    # tsc: src/ -> dist/ (test/ is excluded)
npm start        # node dist/server.js

docker build -t auth-service .
docker run --env-file .env -d -p 3000:3000 auth-service
```

The project has no lint script. Use Node 24 (CI's version). `better-sqlite3` is a native module, and `node_modules` built on another major version fails to load (`NODE_MODULE_VERSION`).

## Test Commands

```bash
npm test                                   # jest --runInBand (serial, required)
npx jest test/e2e/rbac.users.e2e.test.ts   # single file
npx jest -t "last active admin"            # by test name
```

- `jest.setup.ts` loads `.env.test` first, and the later `dotenv.config()` in `jwt.ts` does not override those values. It also defaults `ADMIN_EMAIL`/`ADMIN_PASSWORD` to test-only values when they're unset.
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
- **CI/CD** (`.github/workflows/ci-cd.yml`): runs on pushes to `main`. The pipeline runs `npm test` on Node 24, then pushes the image to Docker Hub (`etcruz/auth-service`), then triggers the Render deploy hook. On Render, set `ADMIN_EMAIL`/`ADMIN_PASSWORD` before the first RBAC deploy, or no one will be able to manage users and roles.
