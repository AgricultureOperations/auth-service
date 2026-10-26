# Deploying RBAC (migration `002_rbac`) to another environment

auth-service applies its own schema changes. On startup, `src/data/database.ts` runs every migration missing from
`schema_migrations` (`src/data/migrate.ts`), then runs the idempotent seed (`src/data/seed.ts`). **Deploying the new
image is normally enough.** Use the SQL below only to apply the migration by hand (for example, to prepare a database
before a deploy) or to check the result.

## Before you deploy

1. **Back up the SQLite file.** The migration rebuilds the `users` table.
   ```bash
   cp data/database.db data/database.db.bak-$(date +%Y%m%d%H%M)
   ```
2. **Set `ADMIN_EMAIL` / `ADMIN_PASSWORD`** (min 8 characters) to an email that is **not registered yet**. Existing
   users are moved to `viewer`, and the seed never changes an existing account. Without an admin, no one can open
   `/users` or `/roles`. To promote an existing account instead, see [Promote a user to admin](#promote-a-user-to-admin).
3. **Deploy auth-service before the dashboard.** Every token issued before the deploy has no `tv` claim, so it gets
   one 401 and the user logs in again.

## Option A: automatic (recommended)

Deploy the image and check the logs:

```
[db] Applied migrations: 001_baseline, 002_rbac
```

Then run the [verification queries](#verify).

## Option B: apply the SQL by hand

The script below does exactly what `002_rbac` and the first seed run do. It was checked against a pre-RBAC database:
the schema and data match what the app produces, and the app then applies nothing and changes nothing on startup.
The script records both migration ids in `schema_migrations`. **Run it only once, and only on a database that
hasn't been migrated**: it fails on `CREATE TABLE actions` if `002_rbac` has already run.

Stop auth-service first. The runtime image has no `sqlite3`, so run the script on a copy of the file:

```bash
# compose: copy the database out of the volume, migrate it, copy it back
docker compose stop auth-service
docker compose cp auth-service:/app/data/database.db ./database.db
sqlite3 ./database.db < rbac.sql
docker compose cp ./database.db auth-service:/app/data/database.db
docker compose start auth-service

# local (npm run dev)
sqlite3 data/database.db < rbac.sql
```

`rbac.sql`:

```sql
PRAGMA foreign_keys = OFF;
BEGIN;

-- 001_baseline (the pre-migration schema)
CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('001_baseline', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- 002_rbac: RBAC tables
CREATE TABLE actions (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE resources (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE permissions (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    UNIQUE (resource_id, action_id)
);
CREATE TABLE roles (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE, description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO roles (id, key, name, description, is_system)
VALUES (lower(hex(randomblob(16))), 'viewer', 'Viewer', 'Read-only access to products and orders', 1);

-- 002_rbac: rebuild users with name, role, status and token_version; existing users become viewer
CREATE TABLE users_new (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, name TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
);
INSERT INTO users_new (id, email, password, name, role_id)
SELECT id, email, password,
       CASE WHEN instr(email, '@') > 1 THEN substr(email, 1, instr(email, '@') - 1) ELSE email END,
       (SELECT id FROM roles WHERE key = 'viewer')
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_permissions_resource_id ON permissions(resource_id);
CREATE INDEX idx_permissions_action_id ON permissions(action_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX idx_role_permissions_granted_by ON role_permissions(granted_by);
CREATE TABLE seed_history (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

INSERT INTO schema_migrations (id, applied_at) VALUES ('002_rbac', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Seed: the rows src/data/seed.ts writes on first run
INSERT INTO actions (id, key, name) VALUES
    (lower(hex(randomblob(16))), 'view', 'View'),
    (lower(hex(randomblob(16))), 'create', 'Create'),
    (lower(hex(randomblob(16))), 'edit', 'Edit'),
    (lower(hex(randomblob(16))), 'delete', 'Delete');
INSERT INTO resources (id, key, name, description, sort_order) VALUES
    (lower(hex(randomblob(16))), 'products', 'Products', 'Product catalog (product-service)', 10),
    (lower(hex(randomblob(16))), 'orders', 'Orders', 'Orders (order-service)', 20),
    (lower(hex(randomblob(16))), 'users', 'Users', 'Platform users', 30),
    (lower(hex(randomblob(16))), 'roles', 'Roles & permissions', 'Roles and their permissions', 40);
INSERT INTO permissions (id, resource_id, action_id, code)
SELECT lower(hex(randomblob(16))), r.id, a.id, r.key || ':' || a.key FROM resources r CROSS JOIN actions a;

INSERT INTO roles (id, key, name, description, is_system) VALUES
    (lower(hex(randomblob(16))), 'admin', 'Administrator', 'Full access, including users and roles', 1),
    (lower(hex(randomblob(16))), 'operator', 'Operator', 'Manages products and orders', 1);

INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE key = 'admin'), id FROM permissions;
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE key = 'operator'), id FROM permissions
WHERE code IN ('products:view','products:create','products:edit','orders:view','orders:create','orders:edit');
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE key = 'viewer'), id FROM permissions WHERE code IN ('products:view','orders:view');
-- Marks the default grants as applied, so later admin edits survive restarts
INSERT INTO seed_history (key, applied_at) VALUES
    ('role-defaults:operator', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('role-defaults:viewer', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check; -- must print nothing
```

The script doesn't create the first admin, because the password must be hashed with bcrypt. Either set
`ADMIN_EMAIL` / `ADMIN_PASSWORD` before the next start, or promote an existing user (next section).

## Promote a user to admin

Increasing `token_version` cancels the user's current token, so the next login carries the new role.

```sql
UPDATE users
SET role_id       = (SELECT id FROM roles WHERE key = 'admin'),
    token_version = token_version + 1,
    updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE email = 'you@example.com';
```

From a running compose container (it has no `sqlite3`, but the app's `better-sqlite3` is installed):

```bash
docker compose exec auth-service node -e "
const db = require('better-sqlite3')('/app/data/' + (process.env.DB_FILE || 'database.db'));
console.log(db.prepare(\"UPDATE users SET role_id=(SELECT id FROM roles WHERE key='admin'), token_version=token_version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=?\").run('you@example.com').changes, 'row(s) updated');
"
```

## Verify

```sql
SELECT id, applied_at FROM schema_migrations ORDER BY id;           -- 001_baseline, 002_rbac
SELECT count(*) FROM permissions;                                    -- 16
SELECT r.key, count(rp.permission_id) FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.key;  -- admin 16, operator 6, viewer 2
SELECT u.email, r.key AS role, u.is_active FROM users u JOIN roles r ON r.id = u.role_id;
SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
WHERE r.key = 'admin' AND u.is_active = 1 LIMIT 1;                  -- must return a row
PRAGMA foreign_key_check;                                            -- must print nothing
```

## Rollback

There is no down migration. Stop the service, restore the backup from step 1 and deploy the previous image. Tokens
issued by the new version have different claims, so users log in again.
