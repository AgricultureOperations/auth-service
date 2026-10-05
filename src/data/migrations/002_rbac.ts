import crypto from "node:crypto";
import type { Migration } from "../migrate";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// RBAC tables, plus a rebuild of users (SQLite can't add a NOT NULL foreign key in place).
// Existing users are backfilled with the viewer role; data/seed.ts fills in everything else.
export const rbac: Migration = {
    id: "002_rbac",
    up: (db) => {
        db.exec(`
            CREATE TABLE actions (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL
            );

            CREATE TABLE resources (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (${NOW})
            );

            CREATE TABLE permissions (
                id TEXT PRIMARY KEY,
                resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
                action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
                code TEXT NOT NULL UNIQUE,
                UNIQUE (resource_id, action_id)
            );

            CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT (${NOW}),
                updated_at TEXT NOT NULL DEFAULT (${NOW})
            );
        `);

        db.prepare(
            "INSERT OR IGNORE INTO roles (id, key, name, description, is_system) VALUES (?, 'viewer', 'Viewer', 'Read-only access to products and orders', 1)"
        ).run(crypto.randomUUID());
        const viewer = db.prepare("SELECT id FROM roles WHERE key = 'viewer'").get() as { id: string };

        db.exec(`
            CREATE TABLE users_new (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                token_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (${NOW}),
                updated_at TEXT NOT NULL DEFAULT (${NOW}),
                last_login_at TEXT
            );
        `);
        db.prepare(`
            INSERT INTO users_new (id, email, password, name, role_id)
            SELECT id, email, password,
                   CASE WHEN instr(email, '@') > 1 THEN substr(email, 1, instr(email, '@') - 1) ELSE email END,
                   ?
            FROM users
        `).run(viewer.id);
        db.exec(`
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;

            CREATE TABLE role_permissions (
                role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                granted_at TEXT NOT NULL DEFAULT (${NOW}),
                granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
                PRIMARY KEY (role_id, permission_id)
            );

            CREATE INDEX idx_users_role_id ON users(role_id);
            CREATE INDEX idx_permissions_resource_id ON permissions(resource_id);
            CREATE INDEX idx_permissions_action_id ON permissions(action_id);
            CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);
            CREATE INDEX idx_role_permissions_granted_by ON role_permissions(granted_by);

            -- One row per one-time seed step (e.g. a system role's default grants), so re-seeding never undoes admin edits.
            CREATE TABLE seed_history (
                key TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
        `);
    },
};
