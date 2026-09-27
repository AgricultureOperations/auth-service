# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Auth Service is the authentication/authorization microservice of the AgricultureOperations platform. It uses Express 5, TypeScript (strict, CommonJS), SQLite via `better-sqlite3`, bcrypt, and JWT.

## Architectural Pattern: Express Layered Architecture

Requests flow in one direction only: `routes → controllers → services → repositories → SQLite`. Each layer calls only the layer directly below it.

- There is no DI. Controllers create services at module level, and services create `UserRepository` as a class field.
- Wrap controllers in `asyncHandler`. Throw `AppError(message, statusCode)` from services to return a specific status; `errorMiddleware` turns any other error into a 500.
- `authMiddleware` protects routes at mount time in `app.ts`: `/api/v1/auth` is public and `/api/v1/user` is protected. It returns 401 when the `Authorization` header is missing and 403 when the token is invalid.

## Key Folder Responsibilities

| Path | Responsibility |
|---|---|
| `src/app.ts` | Builds the Express app (JSON, CORS, routes, error middleware) without listening; tests import it |
| `src/server.ts` | Entry point: loads `.env` and calls `listen` on `PORT` |
| `src/routes/` | Maps HTTP paths to controller functions |
| `src/controllers/` | HTTP layer: reads `req` and sends the status and JSON response |
| `src/services/` | Business logic (hashing, credential checks, not-found errors) |
| `src/repositories/` | Data access with synchronous prepared statements |
| `src/models/` | TypeScript interfaces (`User`) |
| `src/middlewares/` | JWT auth guard and global error handler |
| `src/utils/` | `jwt.ts` (sign/verify), `AppError`, `asyncHandler` |
| `src/data/database.ts` | Opens one shared SQLite connection at `<cwd>/data/$DB_FILE` and creates the schema with `CREATE TABLE IF NOT EXISTS` (no migrations) |
| `test/unit` | Service tests |
| `test/integration`, `test/e2e` | HTTP tests that drive `app` with Supertest |

## Build & Run Commands

```bash
npm install
npm run dev      # ts-node-dev with watch mode on src/server.ts
npm run build    # tsc: src/ -> dist/ (test/ is excluded)
npm start        # node dist/server.js

docker build -t auth-service .
docker run --env-file .env -d -p 3000:3000 auth-service
```

The project has no lint script.

## Test Commands

```bash
npm test                                   # jest --runInBand (serial, required)
npx jest test/unit/auth.service.test.ts    # single file
npx jest -t "should register and login"    # by test name
```

- `jest.setup.ts` loads `.env.test` first, and the later `dotenv.config()` in `jwt.ts` does not override those values.
- Tests use a real SQLite file (`data/$DB_FILE`) with nothing mocked, and each suite clears it with `DELETE FROM users` in `beforeEach`. That shared file is why tests must run serially.
- `.env.test` is gitignored, so CI runs without it: JWT variables come from GitHub secrets and `DB_FILE` falls back to `database.db`.

## Environment

Required variables are listed in `.env.example`: `PORT`, `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_TIMEEXP`, `DB_FILE`, `FRONTEND_URL` (CORS origin; defaults to `http://localhost:5173`, set to `https://agricultureops.netlify.app` on Render). `jwt.ts` reads the JWT variables once, at module load.

`.env*` files (except `.env.example`) and `*.db` files are ignored by git and excluded from the Docker build context.

## Docker & CI/CD

- **Dockerfile**: a multi-stage build on `node:20-alpine`. The builder stage installs `python3`, `make` and `g++` for the native modules (`bcrypt`, `better-sqlite3`) and runs `npm run build`. The runtime stage runs `npm ci --omit=dev`, copies `dist/`, runs as the `node` user, uses `/app/data` for the database, and exposes port 3000.
- **`.dockerignore`**: excludes `test/`, `dist`, `node_modules`, `.env*` and `*.db`, so the image never contains secrets or local databases.
- **CI/CD** (`.github/workflows/ci-cd.yml`): runs on pushes to `main`. The pipeline runs `npm test` on Node 24, then pushes the image to Docker Hub (`etcruz/auth-service`), then triggers the Render deploy hook.
