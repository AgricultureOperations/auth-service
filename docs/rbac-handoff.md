# RBAC handoff (Phase 1 → Phases 2 and 3)

auth-service now owns roles and permissions and puts them in the JWT. This note covers what the other repos need.

## JWT claims (all consumers)

Signed HS256 with the shared `JWT_SECRET`, `iss` = `JWT_ISSUER` (`auth-service`), `aud` = `JWT_AUDIENCE` (`orders-api`), `exp` from `JWT_TIMEEXP`.

| Claim | Type | Meaning |
|---|---|---|
| `sub` | string (UUID v4) | user id; use this |
| `id` | string (UUID v4) | same as `sub`, kept because the original payload was `{ id, email }` |
| `email` | string | |
| `role` | string | role key: `admin`, `operator`, `viewer` or a custom key |
| `permissions` | string[] | `"<resource>:<action>"`, e.g. `orders:view`, `products:edit` |
| `tv` | number | token version; only auth-service checks it |

Resources today: `products`, `orders`, `users`, `roles`. Actions: `view`, `create`, `edit`, `delete`.

## Phase 2: order-service and product-service

- **Authorize on `permissions`, not on `role`.** Roles are editable and custom roles exist, so a role name says nothing stable about access. Suggested mapping:

  | Endpoint | Permission |
  |---|---|
  | `GET` list/detail | `<resource>:view` |
  | `POST` | `<resource>:create` |
  | `PUT`/`PATCH` | `<resource>:edit` |
  | `DELETE` | `<resource>:delete` |

- **401 vs 403** (the frontend logs out on any 401 except login):
  - **401**: no token, bad signature, expired, wrong issuer/audience. This is already what `[Authorize]` / `JwtAuthGuard` do.
  - **403** with `{ message }`: a valid token without the needed permission. Never 401 for this.
- **Stale tokens.** Downstream services can't check `tv`, which lives in auth-service's DB. Don't call auth-service to check it (architecture rule: no backend-to-backend calls). After a role or permission change, a downstream service keeps honouring the old token until `exp`, so keep `JWT_TIMEEXP` short (1h today). auth-service itself rejects stale tokens immediately.
- **Ship order.** Consumers must tolerate tokens without `permissions`: an old token issued before the auth-service deploy should be treated as having no permissions, i.e. 403, or simply re-login. auth-service ships first. Its deploy invalidates every existing token (no `tv`), so every user logs in again once.
- **Ownership.** Take the user id from `sub` for ownership (`Order.CustomerId`), never from the request body.
- **Tests.** Sign test tokens with the same claims; include a token that has the resource's `view` but not `edit`.

## Phase 3: frontend

### Contract changes to mirror (`frontend/src/features/users/interfaces/`, new `roles` feature)
- `GET /api/v1/user` now returns `{ data: User[], meta: { page, pageSize, total, totalPages } }`, paginated server-side.
  - Query params: `search`, `roleId`, `isActive`, `page`, `pageSize` (1–100, default 10).
  - `User` = `{ id, name, email, isActive, role: { id, key, name }, createdAt, updatedAt, lastLoginAt }`, with no `password`. This fixes drift #1.
  - `fetch-users.action.ts` also needs the `/api/v1/user` path (drift #2).
- `GET /api/v1/user/:email` is gone; use `GET /api/v1/user/:id`.
- `GET /api/v1/auth/me` returns the current user plus `permissions: string[]`. Use it for the user badge and for showing or hiding actions. **Don't decode the JWT** (architecture rule).
- Error bodies stay `{ status, message }`:
  - 400 validation
  - 401 session (logout)
  - 403 not allowed: show a toast and stay on the page
  - 404 missing
  - 409 guardrail: show the message
- Every existing session gets one 401 after the auth-service deploy.

### Users screen (Asesores-style, `/users`)
- **Toolbar:** a search box ("Buscar usuario…") over name and email, and a status filter: Todos / Activos / Inactivos → `isActive`.
- **Table columns:** Name, Email, Status badge (Activo / Inactivo), Role, Actions.
- **Role column:** an inline role dropdown showing `Name (key)`. Changing it calls `PATCH /user/:id/role`, and on a 409 it shows the message and reverts.
- **Row actions:**
  - Editar → a right-side drawer with Nombre *, Correo (read-only, "El correo no puede ser editado") and Rol. Saving calls `PATCH /user/:id` for the name and `/role` for the role.
  - Inhabilitar / Habilitar → `PATCH /user/:id/status`. **Add a confirmation dialog.** The reference fires immediately, which we don't want to copy.
  - Eliminar → `ConfirmDialog` → `DELETE`.
- **"Nuevo usuario"** opens a drawer: Nombre *, Correo *, Contraseña * (min 8), Rol (default Viewer). Submit stays disabled until the form is valid.
- **Footer:** "1–10 de N", page size 5/10/20/50, numbered pages.
- **States:** skeleton rows while loading; an empty state ("No hay usuarios para este filtro" plus a hint).
- Hide create, edit and delete controls when `me.permissions` lacks `users:create` / `users:edit` / `users:delete`. The backend enforces this anyway.

### Roles & Permissions screen (Permisos-panel-style)
- **Tab "Roles y permisos"** is the matrix:
  - A role selector, then rows = resources and columns = actions (from `GET /permissions`), with checkboxes.
  - A row checkbox toggles the whole resource. Buttons: "Marcar todos" / "Desmarcar todos".
  - Search by name or code.
  - Footer: "N de 16 permisos seleccionados" and "Guardar cambios" → `PUT /roles/:id/permissions`.
  - Disable unticking for `admin`, since that returns 409.
  - Note: "Los cambios cierran la sesión de los usuarios con este rol". This is stronger than the reference's "next login".
- **Tab "Administrar roles"** has an inline form: Identificador (auto-slug from the name, editable) + Nombre visible → `POST /roles`. Existing roles are listed as cards (name + key, user count, a System badge), with edit (name/description/active) and delete. Delete is disabled for system roles and for roles with users.
- **Tab "Árbol completo"** isn't needed: permissions are flat (resource × action).

### Reference screenshots (Step 0)
They were captured from the Admisiones dev site. They're kept outside every repo because they contain real people's data. Ask the owner for them; never commit them.

- **Asesores:**
  - `asesores-{1440,390}-{light,dark}`
  - `asesores-search`, `asesores-search-empty`
  - `asesores-filter-open`, `asesores-filter-inactive`
  - `asesores-page-2`, `asesores-pagesize-open`
  - `asesores-row-role-dropdown`
  - `asesores-create-modal`, `asesores-390-create-drawer`, `asesores-create-invalid-values`
  - `asesores-edit-modal`
  - `asesores-loading`
  - `asesores-deactivate-confirm`: this shows that there is **no** confirmation
- **Permisos:**
  - `permisos-{1440,390}-{light,dark}`
  - `permisos-role-select-open`
  - `permisos-search`, `permisos-search-empty`
  - `permisos-tree-row-hover`
  - `permisos-tab-administrar-roles`, `permisos-roles-create-validation`, `permisos-roles-slug-autogen`, `permisos-roles-card-click`
  - `permisos-tab-arbol`
