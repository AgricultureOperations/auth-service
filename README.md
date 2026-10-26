# 🔐 AgriOps Auth Service

Auth Service is the authentication and authorization microservice of the **AgricultureOperations (AgriOps)** platform. It registers users and logs them in, and issues the JWTs (with role and permissions) that the rest of the platform trusts. It also manages users, roles and permissions (RBAC), and the platform's **customers**: users with the `customer` role that orders refer to.

It is built with **Express 5**, **TypeScript** (strict, CommonJS) and **SQLite** (`better-sqlite3`), and follows a **layered architecture**: routes → controllers → services → repositories.

---

## 🌐 Place in the AgriOps Platform

AgriOps is made of five independent apps and services, each in its own repository with its own CI/CD:

| App / service | Repository | Stack | Role |
|---|---|---|---|
| **auth-service** (this repo) | [edwardcruzcruz/typescript-jwt-auth-api](https://github.com/edwardcruzcruz/typescript-jwt-auth-api) | Express 5 + TypeScript + SQLite | Login, JWT issuance, users, roles & permissions (RBAC), customers |
| order-service | [edwardcruzcruz/order-service](https://github.com/edwardcruzcruz/order-service) | ASP.NET Core (.NET 9) + PostgreSQL | Sales orders: lines, status workflow, soft delete, yearly order numbering |
| product-service | [AgricultureOperations/product-service](https://github.com/AgricultureOperations/product-service) | NestJS 11 + Prisma + PostgreSQL | Product catalog (inputs, harvest, equipment) |
| dashboard | [edwardcruzcruz/agriops-web](https://github.com/edwardcruzcruz/agriops-web) | React 18 + Vite | Internal back office (staff) for every backend |
| frontend | not on GitHub yet | Next.js 16, static export | Public customer portal: signup, login, account |

```
dashboard ──(login, users, roles, customers)─▶ auth-service    ──issues JWT──┐
    │                       frontend (customer portal) ──(register, login, me)──▶ auth-service
    │                                                                        │ shared secret/issuer/audience
    ├──(Bearer JWT, orders)──────────────────▶ order-service   ◀─validates───┤
    └──(Bearer JWT, products)────────────────▶ product-service ◀─validates───┘
```

- The browser is the only client. The backends never call each other.
- The only link to the other backends is the **shared JWT configuration**: `JWT_SECRET`, `JWT_ISSUER` (`auth-service`) and `JWT_AUDIENCE` (`orders-api`) must match theirs, or every order and product request returns 401.
- The other services authorize on the token's `permissions` claim (e.g. order-service checks `orders:*` and `settings:*`, and answers 403 without them).
- This service owns the `users`, `roles` and permission tables exclusively. Other services refer to a user only by `id`. Each order-service order stores its customer's id plus a copy of the customer's data, and the frontend reads customers from `/api/v1/customers`.

---

## 🛠 Tech Stack

- Node.js, Express 5, TypeScript (strict, CommonJS)
- SQLite through `better-sqlite3` (synchronous prepared statements), versioned migrations
- `bcrypt` for password hashing, `jsonwebtoken` for HS256 JWTs
- Jest + ts-jest + Supertest for tests
- Docker (multi-stage, `node:20-alpine`), GitHub Actions, Docker Hub, Render

---

## 🧱 Architecture

Requests flow in one direction only, and each layer calls only the layer directly below it:

```
routes → controllers → services → repositories → SQLite
```

| Layer | Responsibility |
|---|---|
| Routes | Map HTTP paths to controllers; `requirePermission("<resource>:<action>")` on every protected route |
| Controllers | Validate `req` (`utils/validation.ts`: UUID v4 ids, allowed body fields, formats) and send the status and JSON. Wrapped in `asyncHandler` |
| Services | Business logic and guardrails (last admin, system roles, duplicate email/tax ID). Throw `AppError(message, statusCode)` |
| Repositories | Data access with synchronous prepared statements and explicit column lists; `inTransaction` for multi-step writes |

Conventions:
- **No DI container.** Controllers create services at module level, and services create repositories as class fields.
- **Errors** are `{ status: "error", message }` with the right status. Clients read only `message`.
- **401 vs 403.** `authMiddleware` returns 401 for a missing, invalid, expired or stale token (the dashboard then logs out). `requirePermission` returns 403 for "signed in but not allowed" (the session is kept).
- **Responses never contain `password`.** Only the login query reads the hash.
- **All routes live under `/api/v1/`.** The dashboard exempts `/api/v1/auth/login` from its 401 logout handling by exact path, so don't rename that route.

---

## 📁 Project Structure

```bash
src/
 ├── app.ts              # Builds the Express app (JSON, CORS, routes, error middleware); no listen, so tests can import it
 ├── server.ts           # Entry point: loads .env, listens on 0.0.0.0:$PORT
 ├── routes/             # auth, user, role, permission, customer routers
 ├── controllers/        # HTTP layer + input validation
 ├── services/           # AuthService, UserService, RoleService, PermissionService, CustomerService
 ├── repositories/       # UserRepository, RoleRepository, PermissionRepository, inTransaction
 ├── models/             # Row types, DTOs and to*Dto mappers (UserDto, CustomerDto, RoleDto, …)
 ├── middlewares/        # authMiddleware (401), requirePermission / requireRole (403), errorMiddleware
 ├── utils/              # jwt.ts, validation.ts, AppError, asyncHandler
 └── data/               # database.ts, migrate.ts, migrations/ (001_baseline, 002_rbac, 003_customer_fields), seed.ts

docs/
 ├── rbac-handoff.md     # Contract notes for order-service, product-service and the dashboard
 └── rbac-deployment.md  # Deploying RBAC to another environment: backup, first admin, manual SQL, rollback

test/
 ├── helpers/db.ts       # resetDb(), userWithRole(key), adminToken(), bearer(), roleId()
 ├── unit/               # Service, migration and seed tests
 ├── integration/        # HTTP tests against `app`
 └── e2e/                # Supertest flows; rbac.*.e2e.test.ts cover 401/403/2xx for every endpoint
```

---

## 🔐 Roles & Permissions

Permissions are `"<resource>:<action>"` codes: resources `products`, `orders`, `users`, `roles`, `customers`, `settings` × actions `view`, `create`, `edit`, `delete`.

| Role | Default permissions |
|---|---|
| `admin` | Everything, always (its permissions can't be reduced) |
| `operator` | view/create/edit on `products`, `orders` and `customers` |
| `viewer` | view on `products`, `orders` and `customers` |
| `customer` | none: a buyer referenced by orders. Signs in to the customer portal only |

- `settings:*` (e.g. order-service's order number prefix) is **admin only** by default.
- Admins can create custom roles and change any non-admin role's permissions from the dashboard's Roles screen.
- Guardrails (409): the last active admin can't be demoted, deactivated or deleted; system roles can't be deleted or deactivated; a role with users can't be deleted or deactivated.
- Public registration (the customer portal) always creates a `customer`, whatever the body says. Staff accounts are created by an admin through `/user`.
- Changing a user's role, deactivating them or changing a role's permissions bumps the `token_version`, so existing tokens stop working here immediately. Other services honour a token until it expires, so keep `JWT_TIMEEXP` short.

---

## 🔑 API

Base path: `/api/v1`. Bodies are JSON, camelCase and unwrapped (no `{ success, data }` envelope). Lists are `{ data, meta: { page, pageSize, total, totalPages } }`.

| Method | Path | Permission | Success |
|---|---|---|---|
| `POST` | `/auth/register` `{ email, password, name?, taxId?, phone? }` | public, rate limited | 201 `{ id, email }`: always a **customer** |
| `POST` | `/auth/login` `{ email, password }` | public, rate limited | 200 `{ token }` |
| `GET` | `/auth/me` | signed in | 200 `UserDto` + `permissions: string[]` |
| `GET` | `/user?search=&roleId=&isActive=&page=&pageSize=`, `/user/:id` | `users:view` | 200 |
| `POST` | `/user` `{ name, email, password, roleId }` | `users:create` | 201 `UserDto` |
| `PATCH` | `/user/:id` `{ name }`, `/user/:id/role` `{ roleId }`, `/user/:id/status` `{ isActive }` | `users:edit` | 200 `UserDto` |
| `DELETE` | `/user/:id` | `users:delete` | 204 |
| `GET` | `/roles?search=&isActive=`, `/roles/:id` | `roles:view` | 200 (with `userCount`, `permissionIds`) |
| `POST` / `PATCH` / `DELETE` | `/roles`, `/roles/:id` | `roles:create` / `edit` / `delete` | 201 / 200 / 204 |
| `PUT` | `/roles/:id/permissions` `{ permissionIds }` | `roles:edit` | 200 |
| `GET` | `/permissions` (matrix-ready) | `roles:view` | 200 |
| `GET` | `/customers?search=&isActive=&page=&pageSize=`, `/customers/:id` | `customers:view` | 200 `CustomerDto` list / item |
| `POST` | `/customers` `{ name, email, taxId?, phone? }` | `customers:create` | 201 `CustomerDto` |
| `PATCH` | `/customers/:id` `{ name?, taxId?, phone? }` | `customers:edit` | 200 `CustomerDto` |

- `UserDto` = `{ id, name, email, isActive, role: { id, key, name }, createdAt, updatedAt, lastLoginAt, taxId, phone }`.
- `CustomerDto` = `{ id, name, email, taxId, phone, isActive, createdAt, updatedAt }`.

### Customers

- A customer is a user with the `customer` role. Customers created by staff (`POST /customers`) get a random password nobody knows; customers who sign up in the portal (`POST /auth/register`) choose their own and can sign in there. Neither can use the dashboard.
- `taxId` (cédula, RUC or passport) is 5–20 letters, digits or dashes, is stored upper-cased, and is unique. A duplicate email or tax ID returns 409.
- In a PATCH, `null` clears `taxId` or `phone`. The email can't be changed, and a non-customer id returns 404.
- `search` matches name, email or tax ID, and `/user?search=` matches tax IDs too.
- To deactivate or delete a customer, use `/user/:id/status` or `DELETE /user/:id`.

### JWT

HS256 tokens with payload `{ sub, id, email, role, permissions, tv }` plus `iss` (`JWT_ISSUER`), `aud` (`JWT_AUDIENCE`) and `exp` (`JWT_TIMEEXP`). `id` duplicates `sub` for old consumers, and `tv` is the token version. There is no refresh token and no logout endpoint. See `docs/rbac-handoff.md` for what consumers should do with each claim.

---

## 🗄 Database

- SQLite file at `<cwd>/data/$DB_FILE` (default `database.db`). In the container that is `/app/data/$DB_FILE`; mount a **named volume** at `/app/data` so the data outlives the container.
- **Migrations** (`src/data/migrations/`, listed in `index.ts`) run on every startup, each in its own transaction, and are recorded in `schema_migrations`:
  - `001_baseline`: the original `users` table.
  - `002_rbac`: the RBAC tables; existing users become `viewer`.
  - `003_customer_fields`: nullable `users.tax_id` (unique when set) and `users.phone`.
  - Never edit or reorder a migration that has shipped; add a new one with nullable or defaulted columns.
- **Seed** (`src/data/seed.ts`) runs after the migrations and is idempotent:
  - It creates the actions, resources, permissions and system roles, and re-grants admin every permission.
  - Default grants are applied once per role. Grants added later (`GRANT_SETS`, e.g. `grants:customers-v1`) are applied once to existing databases too. Both are recorded in `seed_history`, so an admin's later changes survive restarts.
  - The first admin comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

---

## ⚙️ Getting Started

### 1. Clone and install

```bash
git clone https://github.com/edwardcruzcruz/typescript-jwt-auth-api.git auth-service
cd auth-service
npm install          # use Node 24 (CI's version): better-sqlite3 is a native module
```

### 2. Configure the environment

Copy `.env.example` to `.env` and fill it in:

| Variable | Description |
|---|---|
| `PORT` | Listen port (default `3000`) |
| `JWT_SECRET` | HS256 signing secret, **at least 32 bytes** (order-service rejects shorter keys). Must match the other services |
| `JWT_ISSUER` | Token issuer, `auth-service` |
| `JWT_AUDIENCE` | Token audience, `orders-api` |
| `JWT_TIMEEXP` | Token lifetime, e.g. `1h` |
| `DB_FILE` | SQLite file name inside `data/` (default `database.db`) |
| `FRONTEND_URL` | Allowed CORS origins, comma-separated: the dashboard and the customer portal. Default `http://localhost:5173,http://localhost:3100`. On Render: `https://agricultureops.netlify.app,<portal URL>` |
| `LOGIN_RATE_LIMIT`, `REGISTER_RATE_LIMIT` | Requests per IP per 15 minutes on `/auth/login` (default 20) and `/auth/register` (default 10) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin, created on startup if no user has that email. Optional once an admin exists |

`.env*` files (except `.env.example`) and `*.db` files are gitignored and excluded from the Docker build context. Never commit them.

### 3. Run

```bash
npm run dev      # ts-node-dev with watch mode on src/server.ts
npm run build    # tsc: src/ → dist/ (test/ excluded)
npm start        # node dist/server.js
```

The API is served on `http://localhost:3000`. There is no lint script.

---

## 🧪 Testing

```bash
npm test                                        # jest --runInBand (serial is required)
npx jest test/e2e/rbac.customers.e2e.test.ts    # a single file
npx jest -t "last active admin"                 # a single test by name
```

- Tests use a **real SQLite file** (`data/$DB_FILE`) with nothing mocked. Each suite calls `resetDb()`, which re-seeds, so the tests must run serially. Migration and seed tests use their own temp files and cover an empty database and a pre-RBAC one.
- `rbac.*.e2e.test.ts` check 401/403/2xx for every endpoint. `rbac.customers.e2e.test.ts` covers customers (permissions per role, duplicate email or tax ID, search, PATCH, non-customer 404) and that `settings:*` is admin only.
- `jest.setup.ts` loads `.env.test` first (gitignored). In CI the JWT variables come from GitHub secrets.

---

## 🐳 Docker

```bash
docker build -t auth-service .
docker run --env-file .env -d -p 3000:3000 -v auth-data:/app/data auth-service
```

- Multi-stage build on `node:20-alpine`. The builder stage installs `python3`, `make` and `g++` for the native modules (`bcrypt`, `better-sqlite3`) and compiles TypeScript. The runtime stage installs production dependencies only, runs as the `node` user and exposes port 3000.
- All config is injected at runtime. `.dockerignore` excludes `.env*`, `*.db`, `test/`, `dist` and `node_modules`.
- Migrations and the seed run when the container starts.

### Full stack with docker compose

The workspace root's `docker-compose.yml` runs postgres, auth-service, order-service, product-service, the dashboard and the customer portal (frontend). It reads **only the root `.env`**, never this service's `.env`. Keep the JWT values identical in both files.

```bash
# from the workspace root
docker compose up -d --build auth-service
docker compose logs -f auth-service
```

---

## 🚀 CI/CD

`.github/workflows/ci-cd.yml` runs on pushes to `main` that touch source, tests, package files, `Dockerfile` or workflows:

1. **build-test:** `npm install` and `npm test` on Node 24, with JWT settings from GitHub secrets.
2. **docker:** build and push `etcruz/auth-service:{sha,latest}` to Docker Hub.
3. **deploy:** trigger the Render deploy hook.

**Deploy order:** this service ships first whenever it adds permissions or endpoints that others use. For example, the orders maintainer needs `customers:*`, `settings:*` and `/customers` before order-service v2 and the dashboard are deployed. The customer portal needs the customer self-registration and `FRONTEND_URL` including its origin. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` on Render before the first RBAC deploy, or no one can manage users and roles. `docs/rbac-deployment.md` has the manual steps.

---

## ⚠️ Known Issues

- Other services can't see the `token_version`, so they accept a token until it expires even after a role change. Keep `JWT_TIMEEXP` short.
- There is no email verification or password reset yet: anyone can register a customer with any email (they get no back-office access), and a customer created by staff has no usable password until a reset flow exists.

---

## 🔮 Future Improvements

- Refresh tokens and a server-side logout
- Email verification and password reset (needs a mail service)
- `PATCH /auth/me` so customers can update their own phone from the portal
- OpenAPI / Swagger documentation
- Observability (Prometheus, Grafana)

---

## 🤝 Contributing

- Keep the layering: routes → controllers → services → repositories. No layer skips one below it.
- A new protected resource needs a `RESOURCES` entry in `data/seed.ts`, a router mounted behind `authMiddleware` in `app.ts`, and `requirePermission` on each route. Grants for existing roles go in a new `GRANT_SETS` entry.
- A breaking change to a request or response shape needs a new version (`/api/v2/...`) served alongside v1.
- Status codes are part of the contract: 401 only for "not authenticated", 403 for "not allowed", 404 for missing resources, 409 for conflicts, 400 for validation errors. Error bodies carry `message`.
- A contract change (route, response shape, JWT claim, permission code) needs matching commits in the dashboard, the customer portal (frontend), order-service and/or product-service repos, and coordinated deploys. Add first; never remove a claim or permission that a deployed consumer reads.

---

## 📌 Author

**Edward Cruz**
Backend Developer | Node.js | TypeScript | REST APIs
