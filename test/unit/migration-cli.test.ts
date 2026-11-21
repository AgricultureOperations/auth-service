import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../src/cli/migration";
import { MIGRATIONS_DIR } from "../../src/data/migrator";

const SERVICE_ROOT = path.resolve(__dirname, "..", "..");

// A throwaway service folder: a copy of the real migrations, and data/ for the DB and backups.
const serviceCopy = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "auth-cli-"));
    fs.cpSync(MIGRATIONS_DIR, path.join(root, "migrations"), { recursive: true });
    return root;
};

const run = (root: string, argv: string[], env: NodeJS.ProcessEnv = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, { root, out: (l) => out.push(l), err: (l) => err.push(l), env: { APP_ENV: "DEV", DB_FILE: "cli.db", ...env } });
    return { code, out: out.join("\n"), err: err.join("\n") };
};

const dbPath = (root: string) => path.join(root, "data", "cli.db");
const history = (root: string) => {
    const db = new Database(dbPath(root), { readonly: true });
    try {
        return db.prepare("SELECT migration, status, batch, applied_by, app_env FROM migration_history ORDER BY id").all();
    } finally {
        db.close();
    }
};

describe("scripts/migration.js", () => {
    let root: string;
    beforeEach(() => { root = serviceCopy(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it("status on a database that doesn't exist yet lists everything as pending and creates nothing", () => {
        const { code, out } = run(root, ["status"]);
        expect(code).toBe(0);
        expect(out).toMatch(/001_baseline\s+pending/);
        expect(out).toMatch(/003_customer_fields\s+pending/);
        expect(out).toContain("3 pending");
        expect(fs.existsSync(dbPath(root))).toBe(false);
    });

    it("up applies everything in one batch, backs up first, records the user and seeds", () => {
        const first = run(root, ["up", "--user", "ana@agriops.test"]);
        expect(first.code).toBe(0);
        expect(first.out).toContain("User: ana@agriops.test");
        expect(first.out).toContain("Applied 003_customer_fields (batch 1)");
        expect(first.out).toContain("Seed: done");
        expect(history(root)).toEqual(["001_baseline", "002_rbac", "003_customer_fields"].map((migration) => ({
            migration, status: "applied", batch: 1, applied_by: "ana@agriops.test", app_env: "DEV",
        })));
        // The file didn't exist before, so the "before" copy is of an empty database.
        expect(fs.readdirSync(path.join(root, "data", "backups"))).toEqual([expect.stringMatching(/^\d{8}T\d{6}Z-before-001_baseline\.db$/)]);

        const second = run(root, ["up", "--user", "ana@agriops.test"]);
        expect(second.out).toContain("Nothing to migrate.");

        const status = run(root, ["status"]);
        expect(status.out).toMatch(/002_rbac\s+applied\s+1\s+ana@agriops\.test\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z\s+DEV/);
        expect(status.out).toContain("Nothing pending.");
    });

    it("a .sql path applies only that file and skips the seed while others are pending", () => {
        const file = path.join(root, "migrations", "001_baseline.sql");
        const result = run(root, [file], { MIGRATION_USER: "luis@agriops.test" });
        expect(result.code).toBe(0);
        expect(result.out).toContain("Applied 001_baseline (batch 1)");
        expect(result.out).toContain("Seed skipped: still pending 002_rbac, 003_customer_fields");
        expect(history(root)).toEqual([expect.objectContaining({ migration: "001_baseline", applied_by: "luis@agriops.test" })]);

        const skip = run(root, [path.join(root, "migrations", "003_customer_fields.sql")], { MIGRATION_USER: "luis" });
        expect(skip.code).toBe(1);
        expect(skip.err).toContain("Apply the earlier pending migrations first: 002_rbac");
    });

    it("history lists every attempt, including failed ones", () => {
        fs.writeFileSync(path.join(root, "migrations", "004_broken.sql"), "SELECT * FROM no_such_table;");
        const up = run(root, ["up", "--user", "ana", "--no-backup"]);
        expect(up.code).toBe(1);
        expect(up.err).toContain("004_broken failed and was rolled back: no such table: no_such_table");

        const { code, out } = run(root, ["history"]);
        expect(code).toBe(0);
        const lines = out.split("\n");
        expect(lines.find((l) => l.includes("004_broken"))).toMatch(/failed\s+1\s+ana\s+DEV/);
        expect(lines.filter((l) => /\bapplied\b/.test(l))).toHaveLength(3);
    });

    it("verify fails when an applied migration's file changed", () => {
        run(root, ["up", "--user", "ana", "--no-backup", "--no-seed"]);
        expect(run(root, ["verify"]).code).toBe(0);
        fs.appendFileSync(path.join(root, "migrations", "002_rbac.sql"), "\n-- edited");
        const verify = run(root, ["verify"]);
        expect(verify.code).toBe(1);
        expect(verify.err).toContain("002_rbac: the file changed after it was applied");
        expect(run(root, ["status"]).err).toContain("002_rbac (changed)");
    });

    describe("PROD safeguards", () => {
        it("needs --yes, and creates nothing without it", () => {
            const result = run(root, ["up", "--user", "ana"], { APP_ENV: "PROD" });
            expect(result.code).toBe(1);
            expect(result.err).toContain("add --yes");
            expect(fs.existsSync(dbPath(root))).toBe(false);
        });

        it("needs an explicit user", () => {
            const result = run(root, ["up", "--yes"], { APP_ENV: "prod" });
            expect(result.code).toBe(1);
            expect(result.err).toContain("needs --user");
        });

        it("doesn't allow skipping the backup", () => {
            expect(run(root, ["up", "--yes", "--user", "ana", "--no-backup"], { APP_ENV: "PROD" }).err).toContain("--no-backup is not allowed");
        });

        it("defaults to PROD inside the production image", () => {
            const result = run(root, ["up"], { APP_ENV: undefined, NODE_ENV: "production" });
            expect(result.err).toContain("APP_ENV=PROD: add --yes");
        });

        it("applies with --yes and a user", () => {
            const result = run(root, ["up", "--yes"], { APP_ENV: "PROD", MIGRATION_USER: "ops@agriops.test" });
            expect(result.code).toBe(0);
            expect(history(root)[0]).toMatchObject({ applied_by: "ops@agriops.test", app_env: "PROD" });
        });
    });

    it("falls back to the git email or the OS user outside PROD", () => {
        run(root, ["up", "--no-backup", "--no-seed"]);
        expect((history(root)[0] as { applied_by: string }).applied_by).not.toBe("");
    });

    it("make creates the next numbered file", () => {
        const { code, out } = run(root, ["make", "Add user locale"]);
        expect(code).toBe(0);
        expect(out).toContain("004_add_user_locale.sql");
        expect(fs.readFileSync(path.join(root, "migrations", "004_add_user_locale.sql"), "utf8")).toContain("-- 004_add_user_locale:");
    });

    it("rejects unknown commands, options and APP_ENV values", () => {
        expect(run(root, ["migrate"]).err).toContain('Unknown command "migrate"');
        expect(run(root, ["status", "--force"]).err).toContain("Unknown option --force");
        expect(run(root, ["status"], { APP_ENV: "staging" }).err).toContain("APP_ENV must be DEV, TEST or PROD");
    });

    it("runs from any folder through the executable launcher", () => {
        const workspace = path.resolve(SERVICE_ROOT, "..");
        const result = spawnSync(path.join(SERVICE_ROOT, "scripts", "migration.js"), ["status"], {
            cwd: workspace,
            env: { ...process.env, APP_ENV: "TEST", DB_FILE: `cli-launcher-${process.pid}.db` },
            encoding: "utf8",
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/001_baseline\s+pending/);
        expect(fs.existsSync(path.join(SERVICE_ROOT, "data", `cli-launcher-${process.pid}.db`))).toBe(false);
    }, 30000);
});
