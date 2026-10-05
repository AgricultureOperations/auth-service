import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../src/data/migrate";
import { seed } from "../../src/data/seed";

const ADMIN = { adminEmail: "first-admin@agriops.test", adminPassword: "Admin-Pass-123", log: () => {} };

const counts = (db: Database.Database) =>
    Object.fromEntries(["actions", "resources", "permissions", "roles", "role_permissions", "users"].map((t) =>
        [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

const grants = (db: Database.Database, roleKey: string) =>
    (db.prepare(`
        SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE r.key = ? ORDER BY p.code
    `).all(roleKey) as { code: string }[]).map((r) => r.code);

describe("seed", () => {
    let db: Database.Database;
    let file: string;
    beforeEach(() => {
        file = path.join(os.tmpdir(), `auth-seed-${crypto.randomUUID()}.db`);
        db = new Database(file);
        db.pragma("foreign_keys = ON");
        runMigrations(db);
    });
    afterEach(() => { db.close(); fs.rmSync(file, { force: true }); });

    it("is idempotent", () => {
        seed(db, ADMIN);
        const first = counts(db);
        const ids = db.prepare("SELECT id, code FROM permissions ORDER BY code").all();
        seed(db, ADMIN);
        seed(db, ADMIN);
        expect(counts(db)).toEqual(first);
        expect(db.prepare("SELECT id, code FROM permissions ORDER BY code").all()).toEqual(ids);
        expect(first).toMatchObject({ actions: 4, resources: 4, permissions: 16, roles: 3, users: 1 });
    });

    it("grants admin everything, operator view/create/edit and viewer view on products and orders", () => {
        seed(db, ADMIN);
        expect(grants(db, "admin")).toHaveLength(16);
        expect(grants(db, "operator")).toEqual([
            "orders:create", "orders:edit", "orders:view", "products:create", "products:edit", "products:view",
        ]);
        expect(grants(db, "viewer")).toEqual(["orders:view", "products:view"]);
        expect(db.prepare("SELECT key FROM roles WHERE is_system = 1 ORDER BY key").all()).toEqual([
            { key: "admin" }, { key: "operator" }, { key: "viewer" },
        ]);
    });

    it("keeps an admin's edits to a system role's grants across re-seeds", () => {
        seed(db, ADMIN);
        db.prepare(`
            DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE key = 'viewer')
        `).run();
        seed(db, ADMIN);
        expect(grants(db, "viewer")).toEqual([]);
    });

    it("re-grants admin every permission, even after a manual removal", () => {
        seed(db, ADMIN);
        db.prepare("DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE key = 'admin')").run();
        seed(db, ADMIN);
        expect(grants(db, "admin")).toHaveLength(16);
    });

    it("creates the first admin once and never escalates an existing account", () => {
        seed(db, ADMIN);
        const admin = db.prepare(`
            SELECT u.name, r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?
        `).get(ADMIN.adminEmail);
        expect(admin).toEqual({ name: "Administrator", key: "admin" });

        const viewerId = (db.prepare("SELECT id FROM roles WHERE key = 'viewer'").get() as { id: string }).id;
        db.prepare(`
            INSERT INTO users (id, email, password, name, role_id) VALUES (?, 'someone@agriops.test', 'x', 'someone', ?)
        `).run(crypto.randomUUID(), viewerId);
        seed(db, { ...ADMIN, adminEmail: "someone@agriops.test" });
        expect(db.prepare("SELECT role_id FROM users WHERE email = 'someone@agriops.test'").get()).toEqual({ role_id: viewerId });
    });

    it("skips the admin with a warning when the password is too short or the vars are missing", () => {
        const log = jest.fn();
        seed(db, { adminEmail: "a@agriops.test", adminPassword: "short", log });
        expect(log).toHaveBeenCalledWith(expect.stringContaining("at least 8"));
        seed(db, { log });
        expect(log).toHaveBeenLastCalledWith(expect.stringContaining("No active admin"));
        expect(counts(db).users).toBe(0);
    });
});
