import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../src/data/migrate";
import { seed } from "../../src/data/seed";
import { UUID_V4 } from "../helpers/db";

// Each test gets its own temp DB file, separate from the shared test DB.
const tempDb = () => {
    const file = path.join(os.tmpdir(), `auth-migrate-${crypto.randomUUID()}.db`);
    const db = new Database(file);
    db.pragma("foreign_keys = ON");
    return { db, file };
};

const ID_COLUMNS: [string, string[]][] = [
    ["users", ["id", "role_id"]],
    ["roles", ["id"]],
    ["resources", ["id"]],
    ["actions", ["id"]],
    ["permissions", ["id", "resource_id", "action_id"]],
    ["role_permissions", ["role_id", "permission_id"]],
];

describe("runMigrations", () => {
    let handle: ReturnType<typeof tempDb>;
    beforeEach(() => { handle = tempDb(); });
    afterEach(() => { handle.db.close(); fs.rmSync(handle.file, { force: true }); });

    it("migrates a pre-RBAC database: users keep their data and get the viewer role", () => {
        const { db } = handle;
        // The exact schema database.ts created before migrations existed.
        db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)");
        const old = [
            { id: crypto.randomUUID(), email: "ana@agriops.test", password: "$2b$10$hash-one" },
            { id: crypto.randomUUID(), email: "luis@agriops.test", password: "$2b$10$hash-two" },
        ];
        const insert = db.prepare("INSERT INTO users (id, email, password) VALUES (?, ?, ?)");
        old.forEach((u) => insert.run(u.id, u.email, u.password));

        expect(runMigrations(db)).toEqual(["001_baseline", "002_rbac"]);
        seed(db, { log: () => {} });

        const users = db.prepare(`
            SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id ORDER BY email
        `).all() as Record<string, unknown>[];
        expect(users).toHaveLength(2);
        users.forEach((u, i) => {
            expect(u).toMatchObject({
                id: old[i].id, email: old[i].email, password: old[i].password,
                name: old[i].email.split("@")[0], role_key: "viewer", is_active: 1, token_version: 0, last_login_at: null,
            });
            expect(new Date(u.created_at as string).toISOString()).toBe(u.created_at);
        });
        expect(db.pragma("foreign_key_check")).toEqual([]);
    });

    it("leaves every id a valid UUID v4 after migrating and seeding", () => {
        const { db } = handle;
        db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)");
        db.prepare("INSERT INTO users VALUES (?, 'old@agriops.test', 'x')").run(crypto.randomUUID());
        runMigrations(db);
        seed(db, { adminEmail: "admin@agriops.test", adminPassword: "Admin-Pass-123", log: () => {} });

        for (const [table, columns] of ID_COLUMNS) {
            const rows = db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<string, string>[];
            expect(rows.length).toBeGreaterThan(0);
            rows.forEach((row) => columns.forEach((c) => expect(row[c]).toMatch(UUID_V4)));
        }
    });

    it("builds the schema on an empty database and is a no-op the second time", () => {
        const { db } = handle;
        expect(runMigrations(db)).toEqual(["001_baseline", "002_rbac"]);
        expect(runMigrations(db)).toEqual([]);
        expect(db.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toEqual([{ id: "001_baseline" }, { id: "002_rbac" }]);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    });

    it("rolls a failing migration back completely and doesn't record it", () => {
        const { db } = handle;
        const failing = { id: "999_broken", up: (d: Database.Database) => { d.exec("CREATE TABLE half_done (a TEXT)"); throw new Error("boom"); } };
        expect(() => runMigrations(db, [failing])).toThrow("boom");
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
        expect(db.prepare("SELECT id FROM schema_migrations").all()).toEqual([]);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    });
});
