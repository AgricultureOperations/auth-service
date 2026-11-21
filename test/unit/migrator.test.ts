import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    MIGRATIONS_DIR, MigrationError, appliedMigrations, checksumOf, ensureHistoryTable, loadMigrations,
    migrationHistory, migrationStatus, pendingMigrations, runPending,
} from "../../src/data/migrator";
import { seed } from "../../src/data/seed";
import { UUID_V4 } from "../helpers/db";

const ALL = ["001_baseline", "002_rbac", "003_customer_fields"];
const RUN = { user: "ana@agriops.test", appEnv: "TEST", hostname: "test-host", backupDir: null };

// Each test gets its own temp folder: a DB file, and a migrations folder when the test needs its own files.
const sandbox = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-migrator-"));
    const db = new Database(path.join(dir, "test.db"));
    db.pragma("foreign_keys = ON");
    return { dir, db };
};

const migrationsDir = (dir: string, files: Record<string, string>) => {
    const target = path.join(dir, "migrations");
    fs.mkdirSync(target);
    Object.entries(files).forEach(([name, sql]) => fs.writeFileSync(path.join(target, name), sql));
    return target;
};

const ID_COLUMNS: [string, string[]][] = [
    ["users", ["id", "role_id"]],
    ["roles", ["id"]],
    ["resources", ["id"]],
    ["actions", ["id"]],
    ["permissions", ["id", "resource_id", "action_id"]],
    ["role_permissions", ["role_id", "permission_id"]],
];

const PRE_RBAC_USERS = "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)";

describe("migrator", () => {
    let box: ReturnType<typeof sandbox>;
    beforeEach(() => { box = sandbox(); });
    afterEach(() => { box.db.close(); fs.rmSync(box.dir, { recursive: true, force: true }); });

    describe("the shipped migrations", () => {
        it("builds the schema on an empty database in one batch and records who, where and when", () => {
            const { db } = box;
            const result = runPending(db, RUN);
            expect(result).toEqual({ batch: 1, applied: ALL, backupFile: null });
            expect(runPending(db, RUN)).toEqual({ batch: null, applied: [], backupFile: null });

            const rows = migrationHistory(db).reverse();
            expect(rows.map((r) => r.migration)).toEqual(ALL);
            const files = loadMigrations();
            rows.forEach((row, i) => {
                expect(row).toMatchObject({
                    status: "applied", batch: 1, applied_by: RUN.user, app_env: "TEST", hostname: "test-host",
                    checksum: files[i].checksum, backup_file: null, error: null,
                });
                expect(new Date(row.started_at).toISOString()).toBe(row.started_at);
                expect(row.duration_ms).toBeGreaterThanOrEqual(0);
            });
            expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        });

        it("migrates a pre-RBAC database: users keep their data and get the viewer role", () => {
            const { db } = box;
            db.exec(PRE_RBAC_USERS);
            const old = [
                { id: crypto.randomUUID(), email: "ana@agriops.test", password: "$2b$10$hash-one" },
                { id: crypto.randomUUID(), email: "luis@agriops.test", password: "$2b$10$hash-two" },
            ];
            const insert = db.prepare("INSERT INTO users (id, email, password) VALUES (?, ?, ?)");
            old.forEach((u) => insert.run(u.id, u.email, u.password));

            expect(runPending(db, RUN).applied).toEqual(ALL);
            seed(db, { log: () => {} });

            const users = db.prepare(`
                SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id ORDER BY email
            `).all() as Record<string, unknown>[];
            expect(users).toHaveLength(2);
            users.forEach((u, i) => {
                expect(u).toMatchObject({
                    id: old[i].id, email: old[i].email, password: old[i].password,
                    name: old[i].email.split("@")[0], role_key: "viewer", is_active: 1, token_version: 0, last_login_at: null,
                    tax_id: null, phone: null,
                });
                expect(new Date(u.created_at as string).toISOString()).toBe(u.created_at);
            });
            expect(db.pragma("foreign_key_check")).toEqual([]);
        });

        it("leaves every id a valid UUID v4 after migrating and seeding", () => {
            const { db } = box;
            db.exec(PRE_RBAC_USERS);
            db.prepare("INSERT INTO users VALUES (?, 'old@agriops.test', 'x')").run(crypto.randomUUID());
            runPending(db, RUN);
            seed(db, { adminEmail: "admin@agriops.test", adminPassword: "Admin-Pass-123", log: () => {} });

            for (const [table, columns] of ID_COLUMNS) {
                const rows = db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<string, string>[];
                expect(rows.length).toBeGreaterThan(0);
                rows.forEach((row) => columns.forEach((c) => expect(row[c]).toMatch(UUID_V4)));
            }
        });
    });

    describe("a database migrated by the old startup runner (schema_migrations only)", () => {
        const legacyDb = (db: Database.Database) => {
            runPending(db, RUN);
            db.exec(`
                DROP TABLE migration_history;
                CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
                INSERT INTO schema_migrations VALUES
                    ('001_baseline', '2026-04-01T10:00:00.000Z'), ('002_rbac', '2026-10-01T10:00:00.000Z'),
                    ('003_customer_fields', '2026-10-24T10:00:00.000Z');
            `);
        };

        it("counts its ids as applied without writing anything", () => {
            const { db } = box;
            legacyDb(db);
            expect(pendingMigrations(db)).toEqual([]);
            expect([...appliedMigrations(db).keys()]).toEqual(ALL);
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'migration_history'").get()).toBeUndefined();
        });

        it("imports them into migration_history as batch 0 on the first command run, and keeps schema_migrations", () => {
            const { db } = box;
            legacyDb(db);
            expect(runPending(db, RUN).applied).toEqual([]);
            expect(migrationHistory(db).reverse()).toEqual(ALL.map((id, i) => expect.objectContaining({
                migration: id, batch: 0, status: "applied", applied_by: "legacy:schema_migrations",
                checksum: loadMigrations()[i].checksum,
            })));
            expect(migrationHistory(db)[0].finished_at).toBe("2026-10-24T10:00:00.000Z");
            expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 3 });
            expect(migrationStatus(db).map((r) => r.state)).toEqual(["applied", "applied", "applied"]);
        });

        it("numbers the next batch after the legacy one", () => {
            const { db, dir } = box;
            legacyDb(db);
            const files = Object.fromEntries(loadMigrations().map((m) => [`${m.id}.sql`, m.sql]));
            const target = migrationsDir(dir, { ...files, "004_add_locale.sql": "ALTER TABLE users ADD COLUMN locale TEXT;" });
            expect(runPending(db, { ...RUN, dir: target })).toEqual({ batch: 1, applied: ["004_add_locale"], backupFile: null });
        });
    });

    describe("failures", () => {
        it("rolls a failing migration back, records the attempt as failed and keeps earlier ones of the batch", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, {
                "001_ok.sql": "CREATE TABLE ok (a TEXT);",
                "002_broken.sql": "CREATE TABLE half_done (a TEXT);\nINSERT INTO no_such_table VALUES (1);",
                "003_after.sql": "CREATE TABLE after (a TEXT);",
            });
            expect(() => runPending(db, { ...RUN, dir: target })).toThrow(/002_broken failed and was rolled back: no such table: no_such_table\. Applied before it in batch 1: 001_ok/);

            const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
            expect(names).toContain("ok");
            expect(names).not.toContain("half_done");
            expect(names).not.toContain("after");
            expect(migrationHistory(db)[0]).toMatchObject({ migration: "002_broken", status: "failed", batch: 1, error: "no such table: no_such_table" });
            expect(pendingMigrations(db, target).map((m) => m.id)).toEqual(["002_broken", "003_after"]);
            expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        });

        it("fails a migration that leaves foreign key violations", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, {
                "001_parent.sql": "CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (parent_id TEXT REFERENCES parent(id));",
                "002_orphan.sql": "INSERT INTO child VALUES ('missing');",
            });
            expect(() => runPending(db, { ...RUN, dir: target })).toThrow(/002_orphan failed .*1 foreign key violation/);
            expect(db.prepare("SELECT COUNT(*) AS n FROM child").get()).toEqual({ n: 0 });
        });

        it("retries a failed migration once its file is fixed (a failed attempt doesn't count as applied)", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, { "001_x.sql": "CREATE TABLE x (a TEXT); SELECT * FROM nope;" });
            expect(() => runPending(db, { ...RUN, dir: target })).toThrow(MigrationError);
            fs.writeFileSync(path.join(target, "001_x.sql"), "CREATE TABLE x (a TEXT);");
            expect(runPending(db, { ...RUN, dir: target })).toMatchObject({ batch: 2, applied: ["001_x"] });
            expect(migrationHistory(db).map((r) => r.status)).toEqual(["applied", "failed"]);
        });

        it("requires a user", () => {
            expect(() => runPending(box.db, { ...RUN, user: "  " })).toThrow("A user is required");
        });
    });

    describe("applying a single file", () => {
        const files = {
            "001_a.sql": "CREATE TABLE a (x TEXT);",
            "002_b.sql": "CREATE TABLE b (x TEXT);",
            "003_c.sql": "CREATE TABLE c (x TEXT);",
        };

        it("applies only the next pending migration, by path or by id", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, files);
            expect(runPending(db, { ...RUN, dir: target, only: path.join(target, "001_a.sql") }).applied).toEqual(["001_a"]);
            expect(runPending(db, { ...RUN, dir: target, only: "002_b" }).applied).toEqual(["002_b"]);
            expect(pendingMigrations(db, target).map((m) => m.id)).toEqual(["003_c"]);
        });

        it("refuses to skip ahead, to re-apply, or to run a file from another folder", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, files);
            expect(() => runPending(db, { ...RUN, dir: target, only: "003_c" })).toThrow("Apply the earlier pending migrations first: 001_a, 002_b");
            runPending(db, { ...RUN, dir: target, only: "001_a" });
            expect(() => runPending(db, { ...RUN, dir: target, only: "001_a.sql" })).toThrow(/001_a was already applied on .* by ana@agriops\.test/);
            const outside = path.join(dir, "004_evil.sql");
            fs.writeFileSync(outside, "DROP TABLE a;");
            expect(() => runPending(db, { ...RUN, dir: target, only: outside })).toThrow("is not in the migrations folder");
            expect(() => runPending(db, { ...RUN, dir: target, only: path.join(target, "009_nope.sql") })).toThrow("Migration file not found");
        });
    });

    describe("files and drift", () => {
        it("rejects badly named files and repeated numbers", () => {
            expect(() => loadMigrations(migrationsDir(box.dir, { "4_bad.sql": "" }))).toThrow('Invalid migration file name "4_bad.sql"');
            const other = fs.mkdtempSync(path.join(os.tmpdir(), "auth-migrator-"));
            try {
                expect(() => loadMigrations(migrationsDir(other, { "001_a.sql": "", "001_b.sql": "" }))).toThrow("share the number 001");
            } finally {
                fs.rmSync(other, { recursive: true, force: true });
            }
        });

        it("reports a file edited after it was applied as changed, and a deleted one as missing", () => {
            const { db, dir } = box;
            const target = migrationsDir(dir, { "001_a.sql": "CREATE TABLE a (x TEXT);", "002_b.sql": "CREATE TABLE b (x TEXT);" });
            runPending(db, { ...RUN, dir: target });
            fs.appendFileSync(path.join(target, "001_a.sql"), "\n-- edited later");
            fs.rmSync(path.join(target, "002_b.sql"));
            expect(migrationStatus(db, target).map((r) => [r.id, r.state])).toEqual([["001_a", "changed"], ["002_b", "missing"]]);
        });

        it("ignores line-ending differences in the checksum", () => {
            expect(checksumOf("a;\r\nb;\r\n")).toBe(checksumOf("a;\nb;\n"));
        });

        it("ships its migrations in <service>/migrations", () => {
            expect(MIGRATIONS_DIR).toBe(path.resolve(__dirname, "..", "..", "migrations"));
            expect(loadMigrations().map((m) => m.id)).toEqual(ALL);
        });
    });

    describe("backups", () => {
        it("copies the database before the first pending migration and records the copy", () => {
            const { db, dir } = box;
            runPending(db, { ...RUN, only: "001_baseline" });
            db.prepare("INSERT INTO users VALUES ('u1', 'ana@agriops.test', 'x')").run();

            const backupDir = path.join(dir, "backups");
            const result = runPending(db, { ...RUN, backupDir, now: () => new Date("2026-11-20T15:04:05.123Z") });
            expect(result.backupFile).toBe(path.join(backupDir, "20261120T150405Z-before-002_rbac.db"));
            expect(migrationHistory(db)[0].backup_file).toBe(result.backupFile);

            const copy = new Database(result.backupFile!, { readonly: true });
            try {
                expect(copy.prepare("SELECT email FROM users").all()).toEqual([{ email: "ana@agriops.test" }]);
                expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'roles'").get()).toBeUndefined();
            } finally {
                copy.close();
            }
        });

        it("takes no backup when nothing is pending", () => {
            const { db, dir } = box;
            runPending(db, RUN);
            const backupDir = path.join(dir, "backups");
            expect(runPending(db, { ...RUN, backupDir }).backupFile).toBeNull();
            expect(fs.existsSync(backupDir)).toBe(false);
        });
    });

    it("ensureHistoryTable is idempotent", () => {
        ensureHistoryTable(box.db, { appEnv: "TEST" });
        ensureHistoryTable(box.db, { appEnv: "TEST" });
        expect(migrationHistory(box.db)).toEqual([]);
    });
});
