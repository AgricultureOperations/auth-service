# 🔐 AgriOps Auth Service

Auth Service is the authentication microservice of the **AgricultureOperations (AgriOps)** platform. It registers users, logs them in, issues the JWTs that the rest of the platform trusts, and serves the user list.

It is built with **Express 5**, **TypeScript** (strict, CommonJS) and **SQLite** (`better-sqlite3`), and follows a **layered architecture**: routes → controllers → services → repositories.

---

## 🌐 Place in the AgriOps Platform

AgriOps is made of three independent services, each in its own repository with its own CI/CD:

| Service | Stack | Role |
|---|---|---|
| **auth-service** (this repo) | Express 5 + TypeScript + SQLite | Users, login, JWT issuance |
| [order-service](https://github.com/edwardcruzcruz/order-service) | ASP.NET Core (.NET 9) + PostgreSQL | JWT-protected order CRUD |
| [agriops-web](https://github.com/edwardcruzcruz/agriops-web) | React 18 + Vite | Back-office SPA for both backends |

```
frontend ──(login/register, users)──▶ auth-service   ──issues JWT──┐
    │                                                              │ shared secret/issuer/audience
    └──(Bearer JWT, orders)──────────▶ order-service ◀─validates───┘
```

- The browser is the only client. The backends never call each other.
- The only link between auth-service and order-service is the **shared JWT configuration**. `JWT_SECRET`, `JWT_ISSUER` (`auth-service`) and `JWT_AUDIENCE` (`orders-api`) must match order-service's `Jwt:Secret`, `Jwt:Issuer` and `Jwt:Audience`. If any of them differ, every order request returns 401.
- This service owns the `users` table exclusively. Other services refer to a user only by `id` (UUID), for example `Order.customerId`.

---

## 🛠 Tech Stack

- Node.js, Express 5, TypeScript (strict, CommonJS)
- SQLite through `better-sqlite3` (synchronous prepared statements)
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
| Routes | Map HTTP paths to controller functions |
| Controllers | Read `req` and send the status and JSON. Wrapped in `asyncHandler` |
| Services | Business logic: hashing, credential checks, not-found errors. Throw `AppError(message, statusCode)` |
| Repositories | Data access with synchronous prepared statements |

Conventions:
- **No DI container.** Controllers create services at module level, and services create `UserRepository` as a class field.
- **Errors.** Throw `AppError` from a service to return a specific status. `errorMiddleware` turns an `AppError` into `{ status: "error", message }` and any other error into a 500 `{ status: "Error", message: "Internal Server Error" }`. Clients read only `message`.
- **Auth at mount time.** `app.ts` mounts `/api/v1/auth` as public and `/api/v1/user` behind `authMiddleware`.
- **All routes live under `/api/v1/`.** The frontend exempts `/api/v1/auth/login` from its 401 logout handling by exact path, so don't rename that route.

---

## 📁 Project Structure

```bash
src/
 ├── app.ts              # Builds the Express app (JSON, CORS, routes, error middleware); no listen, so tests can import it
 ├── server.ts           # Entry point: loads .env, listens on 0.0.0.0:$PORT
 ├── routes/             # auth.routes.ts, user.routes.ts
 ├── controllers/        # HTTP layer
 ├── services/           # AuthService, UserService
 ├── repositories/       # UserRepository (SQL)
 ├── models/             # User interface
 ├── middlewares/        # authMiddleware (JWT guard), errorMiddleware
 ├── utils/              # jwt.ts (sign/verify), AppError, asyncHandler
 └── data/database.ts    # Opens <cwd>/data/$DB_FILE and creates the schema

test/
 ├── unit/               # Service tests
 ├── integration/        # HTTP tests against `app` with Supertest
 └── e2e/                # Full register → login → protected-route flows with Supertest
```

---

## 🔑 API

Base path: `/api/v1`. Bodies are JSON, camelCase and unwrapped (no `{ success, data }` envelope).

| Method | Path | Auth | Success | Body |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | public | 201 | `{ id, email }` |
| `POST` | `/api/v1/auth/login` | public | 200 | `{ token }` |
| `GET` | `/api/v1/user` | Bearer JWT | 200 | `User[]` (bare array) |
| `GET` | `/api/v1/user/:email` | Bearer JWT | 200 | `{ user }` (wrapped) |

Request body for register and login:

```json
{ "email": "user@example.com", "password": "yourPassword123" }
```

Protected routes need the header:

```
Authorization: Bearer <jwt>
```

Errors:
- Login with an unknown email or wrong password returns `401 { status: "error", message: "Invalid credentials" }`.
- `GET /api/v1/user/:email` for an unknown email returns `404 { status: "error", message: "User not found" }`.
- `authMiddleware` returns a bare **401** when the `Authorization` header is missing, and a bare **403** when the token is invalid or expired.

### JWT

`generateToken` signs HS256 tokens with payload `{ id, email }` plus `iss` (`JWT_ISSUER`), `aud` (`JWT_AUDIENCE`) and `exp` (`JWT_TIMEEXP`). There is no refresh token and no logout endpoint. A token stays valid until it expires.

---

## 🗄 Database

- SQLite file at `<cwd>/data/$DB_FILE` (default `database.db`). In the container that is `/app/data/$DB_FILE`. Mount a **named volume** at `/app/data` so the data outlives the container.
- `src/data/database.ts` opens one shared connection and creates the schema with `CREATE TABLE IF NOT EXISTS users (id, email UNIQUE, password)`.
- **There is no migration system.** Editing that `CREATE TABLE` statement has no effect on an existing database. Add schema changes as versioned, idempotent steps (tracked with `PRAGMA user_version`, run inside `db.transaction`), and make new columns nullable or give them defaults.

---

## ⚙️ Getting Started

### 1. Clone and install

```bash
git clone https://github.com/AgricultureOperations/auth-service.git auth-service
cd auth-service
npm install
```

### 2. Configure the environment

Copy `.env.example` to `.env` and fill it in:

| Variable | Description |
|---|---|
| `PORT` | Listen port (default `3000`) |
| `JWT_SECRET` | HS256 signing secret, **at least 32 bytes** (order-service rejects shorter keys). Must match order-service's `Jwt:Secret` |
| `JWT_ISSUER` | Token issuer, `auth-service` |
| `JWT_AUDIENCE` | Token audience, `orders-api` |
| `JWT_TIMEEXP` | Token lifetime, e.g. `1h` |
| `DB_FILE` | SQLite file name inside `data/` (default `database.db`) |
| `FRONTEND_URL` | The only allowed CORS origin. Default `http://localhost:5173`. On Render: `https://agricultureops.netlify.app` |

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
npm test                                   # jest --runInBand (serial is required)
npx jest test/unit/auth.service.test.ts    # a single file
npx jest -t "should register and login"    # a single test by name
```

- Tests use a **real SQLite file** (`data/$DB_FILE`) with nothing mocked. Each suite clears it with `DELETE FROM users` in `beforeEach`, so the tests must run serially.
- `jest.setup.ts` loads `.env.test` first (same keys as `.env`; point `DB_FILE` at a separate test database). `.env.test` is gitignored. In CI the JWT variables come from GitHub secrets, and `DB_FILE` falls back to `database.db`.

---

## 🐳 Docker

```bash
docker build -t auth-service .
docker run --env-file .env -d -p 3000:3000 -v auth-data:/app/data auth-service
```

- Multi-stage build on `node:20-alpine`. The builder stage installs `python3`, `make` and `g++` for the native modules (`bcrypt`, `better-sqlite3`) and compiles TypeScript. The runtime stage installs production dependencies only, runs as the `node` user and exposes port 3000.
- All config is injected at runtime. `.dockerignore` excludes `.env*`, `*.db`, `test/`, `dist` and `node_modules`, so the image contains no secrets or local databases.

### Full stack with docker compose

The workspace root's `docker-compose.yml` runs postgres, auth-service, order-service and the frontend together. It reads **only the root `.env`** (copied from the root `.env.example`), never this service's `.env`. Keep the JWT values identical in both files.

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

---

## ⚠️ Known Issues

These are documented so that they get fixed when the code is touched:

- **User endpoints return bcrypt password hashes.** `UserRepository` uses `SELECT *`, so both `GET /api/v1/user` and `GET /api/v1/user/:email` include `password`. Fix: select `id, email` only, and remove `password` from the frontend `User` type in the same change.
- **`authMiddleware` returns 403 for an expired or invalid token** and checks only the signature, not the issuer or audience. The frontend logs out only on 401, so an expired session isn't cleared on `/users`. Fix: return 401 and validate `issuer`/`audience`, as order-service does.
- **`authMiddleware` doesn't check the `Bearer` scheme** (it takes `split(" ")[1]`), and its 401/403 bodies are plain text, not `{ message }`.
- **Registering an existing email returns a 500**, because the SQLite `UNIQUE` violation isn't mapped to an `AppError`. It should be a 409 or 400 with a `message`.
- There is no input validation on register or login bodies.

---

## 🔮 Future Improvements

- Input validation (Zod / express-validator)
- Refresh tokens and a server-side logout
- OpenAPI / Swagger documentation
- Versioned SQLite migrations (`PRAGMA user_version`)
- Observability (Prometheus, Grafana)

---

## 🤝 Contributing

- Keep the layering: routes → controllers → services → repositories. No layer skips one below it.
- Keep every route under `/api/v1/`. A breaking change to a request or response shape needs a new version (`/api/v2/...`) served alongside v1.
- Status codes are part of the contract: 401 only for "not authenticated", 403 for "not allowed", 404 for missing resources, 400 for validation errors. Error bodies carry `message`.
- A contract change (route, response shape, JWT claim) needs matching commits in the frontend and/or order-service repos and coordinated deploys. Add claims first. Never remove a claim that a deployed consumer reads.

---

## 📌 Author

**Edward Cruz**
Backend Developer | Node.js | TypeScript | REST APIs
