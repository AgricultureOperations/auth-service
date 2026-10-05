import bcrypt from "bcrypt";
import crypto from "node:crypto";
import type { Database } from "better-sqlite3";

// Reference data and system roles. Idempotent: rows are matched by key/name, never by id.

export const ACTIONS = [
    { key: "view", name: "View" },
    { key: "create", name: "Create" },
    { key: "edit", name: "Edit" },
    { key: "delete", name: "Delete" },
];

export const RESOURCES = [
    { key: "products", name: "Products", description: "Product catalog (product-service)" },
    { key: "orders", name: "Orders", description: "Orders (order-service)" },
    { key: "users", name: "Users", description: "Platform users" },
    { key: "roles", name: "Roles & permissions", description: "Roles and their permissions" },
];

export const ADMIN_ROLE = "admin";
export const VIEWER_ROLE = "viewer";

// Defaults are applied once per role (recorded in seed_history), so later edits by an admin survive restarts.
// admin is the exception: it always gets every permission.
export const SYSTEM_ROLES = [
    { key: ADMIN_ROLE, name: "Administrator", description: "Full access, including users and roles", defaults: null },
    {
        key: "operator",
        name: "Operator",
        description: "Manages products and orders",
        defaults: ["products:view", "products:create", "products:edit", "orders:view", "orders:create", "orders:edit"],
    },
    { key: VIEWER_ROLE, name: "Viewer", description: "Read-only access to products and orders", defaults: ["products:view", "orders:view"] },
];

export const MIN_PASSWORD_LENGTH = 8;

export interface SeedOptions {
    adminEmail?: string;
    adminPassword?: string;
    log?: (message: string) => void;
}

export const seed = (db: Database, { adminEmail, adminPassword, log = console.warn }: SeedOptions = {}) => {
    const now = new Date().toISOString();
    const idOf = (table: "actions" | "resources" | "roles", key: string) =>
        (db.prepare(`SELECT id FROM ${table} WHERE key = ?`).get(key) as { id: string }).id;

    db.transaction(() => {
        const upsertAction = db.prepare(
            "INSERT INTO actions (id, key, name) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name"
        );
        ACTIONS.forEach((a) => upsertAction.run(crypto.randomUUID(), a.key, a.name));

        const upsertResource = db.prepare(`
            INSERT INTO resources (id, key, name, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description, sort_order = excluded.sort_order
        `);
        RESOURCES.forEach((r, i) => upsertResource.run(crypto.randomUUID(), r.key, r.name, r.description, (i + 1) * 10, now));

        const insertPermission = db.prepare(
            "INSERT OR IGNORE INTO permissions (id, resource_id, action_id, code) VALUES (?, ?, ?, ?)"
        );
        for (const r of RESOURCES) {
            for (const a of ACTIONS) {
                insertPermission.run(crypto.randomUUID(), idOf("resources", r.key), idOf("actions", a.key), `${r.key}:${a.key}`);
            }
        }

        const insertRole = db.prepare(`
            INSERT OR IGNORE INTO roles (id, key, name, description, is_system, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 1, ?, ?)
        `);
        const grant = db.prepare(`
            INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at, granted_by)
            SELECT ?, id, ?, NULL FROM permissions WHERE code = ?
        `);
        const markSeeded = db.prepare("INSERT OR IGNORE INTO seed_history (key, applied_at) VALUES (?, ?)");
        for (const role of SYSTEM_ROLES) {
            insertRole.run(crypto.randomUUID(), role.key, role.name, role.description, now, now);
            db.prepare("UPDATE roles SET is_system = 1 WHERE key = ?").run(role.key);
            // Tracked in seed_history rather than "row was just inserted": 002_rbac pre-creates viewer for the backfill.
            if (role.defaults && markSeeded.run(`role-defaults:${role.key}`, now).changes > 0) {
                const roleId = idOf("roles", role.key);
                role.defaults.forEach((code) => grant.run(roleId, now, code));
            }
        }
        db.prepare(`
            INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at, granted_by)
            SELECT ?, id, ?, NULL FROM permissions
        `).run(idOf("roles", ADMIN_ROLE), now);
    })();

    seedFirstAdmin(db, adminEmail?.trim(), adminPassword, idOf("roles", ADMIN_ROLE), log);
};

const seedFirstAdmin = (db: Database, email: string | undefined, password: string | undefined, adminRoleId: string, log: (m: string) => void) => {
    if (!email || !password) {
        const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role_id = ? AND is_active = 1 LIMIT 1").get(adminRoleId);
        if (!hasAdmin) log("[seed] No active admin and ADMIN_EMAIL/ADMIN_PASSWORD not set: no one can manage users or roles.");
        return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        log(`[seed] ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters; first admin not created.`);
        return;
    }
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return; // never touch an existing account

    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO users (id, email, password, name, role_id, is_active, token_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(crypto.randomUUID(), email, bcrypt.hashSync(password, 10), "Administrator", adminRoleId, now, now);
};
