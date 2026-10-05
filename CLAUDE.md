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
- `requirePermission("users:edit")` / `requireRole("admin")` (`middlewares/permission.middleware.ts`) run after it and return **403** `{ status, message }`. 401 makes the frontend log out; 403 doesn't, so never return 401 for "not allowed".
- JWT payload: `{ sub, id, email, role, permissions, tv }` (`utils/jwt.ts` `TokenClaims`), HS256 with `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`. `id` duplicates `sub` for old consumers. Other services read these claims; see `docs/rbac-handoff.md`.
- `token_version` is bumped when a user's role changes, when the user is deactivated, and for every holder of a role whose permissions change (`PUT /roles/:id/permissions`). That makes their existing tokens 401 immediately.

## RBAC model

| Table | Notes |
|---|---|
| `actions` | `view`, `create`, `edit`, `delete` |
| `resources` | `products`, `orders`, `users`, `roles` (`sort_order` 10, 20, …) |
| `permissions` | one per resource × action, `code` = `"<resource>:<action>"` |
| `roles` | `key` (slug, immutable, used in the JWT), `name`, `description`, `is_system`, `is_active` |
| `role_permissions` | `granted_at`, `granted_by` (user, `SET NULL` on delete) |
| `users` | `name`, `role_id` (one role per user, `RESTRICT`), `is_active`, `token_version`, `created_at`, `updated_at`, `last_login_at` |

All ids are UUID v4 text (`crypto.randomUUID()`), and all timestamps are ISO 8601 UTC text.

System roles: `admin` (every permission, always), `operator` (view/create/edit on products and orders), `viewer` (view on products and orders). Guardrails (409):
- Nobody can demote, deactivate or delete the last active admin.
- The admin role's permissions can't be reduced.
- System roles can't be deleted or deactivated.
- A role that still has users can't be deleted or deactivated.

Registration always assigns `viewer`.

### Endpoints (all under `/api/v1`)

| Method | Path | Permission |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | public (shapes unchanged: `201 { id, email }`, `{ token }`) |
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

A new protected resource needs: a `RESOURCES` entry in `data/seed.ts` (admin picks up its permissions on the next start), a router mounted behind `authMiddleware` in `app.ts`, and `requirePermission` on each route.

## Migrations and seed

- `src/data/database.ts` opens `<cwd>/data/$DB_FILE`, sets `PRAGMA foreign_keys = ON`, runs `runMigrations(db)` and then `seed(db, …)` at module load. The server and the tests both go through this.
- Migrations are TypeScript modules in `src/data/migrations/`, listed in order in `migrations/index.ts`. They're compiled into `dist/`, since the Dockerfile only copies `src/`. Applied ids are recorded in `schema_migrations`.
- Each migration runs in its own transaction with foreign keys off, and must leave `PRAGMA foreign_key_check` clean. This allows the SQLite rebuild pattern: create the new table, copy the rows, drop the old table, rename.
- **Never edit or reorder a migration that has shipped. Add a new one.** It must run on an empty DB and on the Render/compose volume.
- `002_rbac` rebuilt `users` and backfilled existing users with `viewer` and `name` = the email's local part.
- `seed.ts` is idempotent and matches rows by key/name, never by id. It upserts actions and resources, creates any missing `resource:action` permissions and system roles, and re-grants admin every permission.
- Default grants for `operator`/`viewer` are applied once, recorded in `seed_history`, so an admin's later edits survive restarts.
- The first admin is created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` only if no user has that email; an existing account is never changed.

## Key Folder Responsibilities

| Path | Responsibility |
|---|---|
| `src/app.ts` | Builds the Express app (JSON, CORS, routes, error middleware) without listening; tests import it |
| `src/server.ts` | Entry point: loads `.env` and calls `listen` on `PORT` |
| `src/routes/` | `auth`, `user`, `role`, `permission` routers; `requirePermission` per route |
| `src/controllers/` | HTTP layer: validates `req` (`utils/validation.ts`) and sends the status and JSON response |
| `src/services/` | Business logic and guardrails (`AppError`) |
| `src/repositories/` | Data access with synchronous prepared statements, plus `inTransaction` |
| `src/models/` | Row types, DTOs and `to*Dto` mappers |
| `src/middlewares/` | `authMiddleware` (401), `requirePermission`/`requireRole` (403), error handler |
| `src/utils/` | `jwt.ts` (sign/verify with iss/aud/HS256), `validation.ts`, `AppError`, `asyncHandler` |
| `src/data/` | `database.ts`, `migrate.ts`, `migrations/`, `seed.ts` |
| `test/helpers/db.ts` | `resetDb()`, `userWithRole(key)`, `adminToken()`, `bearer()`, `roleId()` |
| `test/unit` | Service, migration and seed tests (the last two use their own temp DB files) |
| `test/integration`, `test/e2e` | HTTP tests that drive `app` with Supertest (`rbac.*.e2e.test.ts` cover every endpoint for 401/403/2xx) |
| `docs/rbac-handoff.md` | Contract notes for order-service/product-service (Phase 2) and the frontend (Phase 3) |

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
- `.env.test` is gitignored, so CI runs without it: JWT variables come from GitHub secrets and `DB_FILE` falls back to `database.db`.

## Environment

Variables are listed in `.env.example`:
- `PORT`
- `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_TIMEEXP`
- `DB_FILE`
- `FRONTEND_URL`: the CORS origin. Defaults to `http://localhost:5173`; set to `https://agricultureops.netlify.app` on Render.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: the first admin. Optional once an admin exists.

`jwt.ts` reads the JWT variables once, at module load. CORS allows `GET`, `POST`, `PUT`, `PATCH` and `DELETE`.

`.env*` files (except `.env.example`) and `*.db` files are ignored by git and excluded from the Docker build context.

## Docker & CI/CD

- **Dockerfile**: a multi-stage build on `node:20-alpine`. The builder stage installs `python3`, `make` and `g++` for the native modules (`bcrypt`, `better-sqlite3`) and runs `npm run build`. The runtime stage runs `npm ci --omit=dev`, copies `dist/`, runs as the `node` user, uses `/app/data` for the database, and exposes port 3000.
- **`.dockerignore`**: excludes `test/`, `dist`, `node_modules`, `.env*` and `*.db`, so the image never contains secrets or local databases.
- **CI/CD** (`.github/workflows/ci-cd.yml`): runs on pushes to `main`. The pipeline runs `npm test` on Node 24, then pushes the image to Docker Hub (`etcruz/auth-service`), then triggers the Render deploy hook. On Render, set `ADMIN_EMAIL`/`ADMIN_PASSWORD` before the first RBAC deploy, or no one will be able to manage users and roles.
