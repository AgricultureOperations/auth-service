import Database from "better-sqlite3";
import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    HistoryRow, MIGRATIONS_DIR, MigrationError, loadMigrations, migrationHistory, migrationStatus, pendingMigrations, runPending,
} from "../data/migrator";
import { seed } from "../data/seed";

// The migration command (scripts/migration.js). Migrations never run on server startup: run them with this.

const USAGE = `Usage: scripts/migration.js <command> [options]

Commands:
  status                  List every migration: applied (batch, user, date, env) or pending   (default)
  up [file]               Apply every pending migration, or only <file> (it must be the next pending one),
                          then run the idempotent seed
  <file.sql>              Same as: up <file.sql>
  history [--limit N]     Every run, including failed attempts, newest first (default 50)
  verify                  Exit 1 if an applied migration's file changed or is missing
  make <name>             Create migrations/NNN_<name>.sql with the next number

Options:
  --user <name>           Who is running it (recorded). Default: MIGRATION_USER, then git user.email,
                          then <os user>@<host>. Required (flag or MIGRATION_USER) when APP_ENV=PROD
  --yes                   Required to apply migrations when APP_ENV=PROD
  --no-backup             Skip the SQLite copy taken before applying (not allowed when APP_ENV=PROD)
  --no-seed               Don't run the seed after applying

Environment:
  APP_ENV                 DEV (loads .env), TEST (.env.test) or PROD (.env.production, if present).
                          Default: PROD when NODE_ENV=production, otherwise DEV
  DB_FILE                 SQLite file in data/ (default database.db)

Examples:
  APP_ENV=DEV auth-service/scripts/migration.js status
  APP_ENV=DEV auth-service/scripts/migration.js auth-service/migrations/004_add_user_locale.sql
  node scripts/migration.js up --user ana@agriops.com --yes        # on Render (Shell) or in the container
`;

const ENV_FILES: Record<string, string | null> = { DEV: ".env", TEST: ".env.test", PROD: ".env.production" };

export interface CliIo {
    /** The service folder (holds migrations/, data/ and the .env files). */
    root?: string;
    out?: (line: string) => void;
    err?: (line: string) => void;
    env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
    command: string;
    target?: string;
    user?: string;
    yes: boolean;
    backup: boolean;
    seed: boolean;
    limit: number;
}

const parseArgs = (argv: string[]): ParsedArgs => {
    const parsed: ParsedArgs = { command: "status", yes: false, backup: true, seed: true, limit: 50 };
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (next === undefined || next.startsWith("--")) throw new MigrationError(`${arg} needs a value`);
            return next;
        };
        if (arg === "--user") parsed.user = value();
        else if (arg === "--limit") parsed.limit = Number(value());
        else if (arg === "--yes") parsed.yes = true;
        else if (arg === "--no-backup") parsed.backup = false;
        else if (arg === "--no-seed") parsed.seed = false;
        else if (arg === "--help" || arg === "-h") parsed.command = "help";
        else if (arg.startsWith("--")) throw new MigrationError(`Unknown option ${arg}`);
        else positional.push(arg);
    }
    if (parsed.command === "help") return parsed;
    if (positional[0]?.endsWith(".sql")) {
        parsed.command = "up";
        parsed.target = positional[0];
        if (positional.length > 1) throw new MigrationError(`Unexpected argument ${positional[1]}`);
        return parsed;
    }
    if (positional[0]) parsed.command = positional[0];
    parsed.target = positional[1];
    if (positional.length > 2) throw new MigrationError(`Unexpected argument ${positional[2]}`);
    if (!Number.isInteger(parsed.limit) || parsed.limit < 1) throw new MigrationError("--limit must be a positive integer");
    return parsed;
};

const resolveAppEnv = (env: NodeJS.ProcessEnv) => {
    const raw = env.APP_ENV ?? (env.NODE_ENV === "production" ? "PROD" : "DEV");
    const appEnv = raw.trim().toUpperCase();
    if (!(appEnv in ENV_FILES)) throw new MigrationError(`APP_ENV must be DEV, TEST or PROD (got "${raw}")`);
    return appEnv;
};

const gitEmail = (root: string) => {
    try {
        return execFileSync("git", ["config", "user.email"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
        return "";
    }
};

const resolveUser = (args: ParsedArgs, env: NodeJS.ProcessEnv, appEnv: string, root: string) => {
    const explicit = args.user ?? env.MIGRATION_USER;
    if (explicit?.trim()) return explicit.trim();
    if (appEnv === "PROD") {
        throw new MigrationError("APP_ENV=PROD needs --user <name> (or MIGRATION_USER) so the history says who ran it");
    }
    return gitEmail(root) || `${os.userInfo().username}@${os.hostname()}`;
};

const table = (headers: string[], rows: string[][]) => {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
    return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)];
};

const when = (iso: string | undefined) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, "Z") : "");

const historyCells = (r: HistoryRow) => [
    String(r.id), r.migration, r.status, String(r.batch), r.applied_by, r.app_env, r.hostname,
    when(r.started_at), `${r.duration_ms} ms`, r.error ?? "",
];

/** Runs one command and returns the exit code. */
export const main = (argv: string[], io: CliIo = {}): number => {
    const root = io.root ?? path.resolve(__dirname, "..", "..");
    const out = io.out ?? ((line: string) => console.log(line));
    const err = io.err ?? ((line: string) => console.error(line));
    const env = io.env ?? process.env;
    const migrationsDir = io.root ? path.join(root, "migrations") : MIGRATIONS_DIR;
    let db: Database.Database | undefined;

    try {
        const args = parseArgs(argv);
        if (args.command === "help") {
            out(USAGE);
            return 0;
        }

        if (args.command === "make") {
            if (!args.target) throw new MigrationError("make needs a name, e.g. make add_user_locale");
            const name = args.target.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            if (!name) throw new MigrationError(`"${args.target}" has no usable characters for a file name`);
            const existing = loadMigrations(migrationsDir);
            const last = existing[existing.length - 1];
            const next = String((last ? Number(last.id.slice(0, 3)) : 0) + 1).padStart(3, "0");
            const file = path.join(migrationsDir, `${next}_${name}.sql`);
            fs.writeFileSync(file, `-- ${next}_${name}: <what this changes and why>\n` +
                "-- Runs in one transaction with foreign keys off; it must leave PRAGMA foreign_key_check clean.\n" +
                "-- Additive only (nullable or defaulted columns, new tables): the previous image may still be running.\n" +
                "-- Don't write BEGIN/COMMIT. Never edit this file once it has been applied anywhere.\n\n");
            out(`Created ${path.relative(process.cwd(), file)}`);
            return 0;
        }

        const appEnv = resolveAppEnv(env);
        const envFile = ENV_FILES[appEnv];
        if (envFile && fs.existsSync(path.join(root, envFile))) {
            // Variables already set in the shell win over the file.
            dotenv.config({ path: path.join(root, envFile), processEnv: env as Record<string, string>, quiet: true });
        }
        const dataDir = path.join(root, "data");
        const dbFile = path.join(dataDir, env.DB_FILE || "database.db");
        const label = `${appEnv} · ${path.relative(process.cwd(), dbFile) || dbFile}`;

        if (!["status", "up", "history", "verify"].includes(args.command)) {
            throw new MigrationError(`Unknown command "${args.command}". Run with --help for usage`);
        }
        let user = "";
        if (args.command === "up") {
            if (appEnv === "PROD" && !args.yes) throw new MigrationError("APP_ENV=PROD: add --yes to apply migrations to production");
            if (appEnv === "PROD" && !args.backup) throw new MigrationError("--no-backup is not allowed when APP_ENV=PROD");
            user = resolveUser(args, env, appEnv, root);
        } else if (args.target) {
            throw new MigrationError(`Unexpected argument ${args.target}`);
        }

        if (args.command === "up") {
            fs.mkdirSync(dataDir, { recursive: true });
            db = new Database(dbFile);
        } else if (fs.existsSync(dbFile)) {
            db = new Database(dbFile, { readonly: true, fileMustExist: true });
        } else {
            // Read-only commands never create the database file.
            out(`(${label} doesn't exist yet: every migration is pending)`);
            db = new Database(":memory:");
        }
        db.pragma("foreign_keys = ON");
        db.pragma("busy_timeout = 5000"); // the server may hold the database while this runs

        if (args.command === "status") {
            const rows = migrationStatus(db, migrationsDir);
            out(`Database: ${label}`);
            out("");
            table(["Migration", "Status", "Batch", "Applied by", "Applied at (UTC)", "Env"], rows.map((r) => [
                r.id, r.state, r.record ? String(r.record.batch) : "", r.record?.applied_by ?? (r.state === "pending" ? "" : "legacy"),
                when(r.record?.finished_at), r.record?.app_env ?? "",
            ])).forEach(out);
            const pending = rows.filter((r) => r.state === "pending").length;
            out("");
            out(pending ? `${pending} pending. Apply with: scripts/migration.js up` : "Nothing pending.");
            const drift = rows.filter((r) => r.state === "changed" || r.state === "missing");
            if (drift.length) err(`Warning: ${drift.map((r) => `${r.id} (${r.state})`).join(", ")}. Applied migrations must not be edited or deleted.`);
            return 0;
        }

        if (args.command === "history") {
            const rows = migrationHistory(db, args.limit);
            out(`Database: ${label}`);
            out("");
            if (!rows.length) {
                out("No migration has been run with this command yet.");
                return 0;
            }
            table(["#", "Migration", "Status", "Batch", "User", "Env", "Host", "Started (UTC)", "Took", "Error"], rows.map(historyCells)).forEach(out);
            return 0;
        }

        if (args.command === "verify") {
            const drift = migrationStatus(db, migrationsDir).filter((r) => r.state === "changed" || r.state === "missing");
            if (!drift.length) {
                out(`OK: every applied migration matches its file (${label}).`);
                return 0;
            }
            drift.forEach((r) => err(`${r.id}: ${r.state === "changed" ? "the file changed after it was applied" : "applied, but the file is missing"}`));
            return 1;
        }

        // up
        out(`Database: ${label}`);
        out(`User: ${user}`);
        const result = runPending(db, {
            user, appEnv, dir: migrationsDir, only: args.target,
            backupDir: args.backup ? path.join(dataDir, "backups") : null,
        });
        if (!result.applied.length) {
            out("Nothing to migrate.");
        } else {
            if (result.backupFile) out(`Backup: ${path.relative(process.cwd(), result.backupFile)}`);
            result.applied.forEach((id) => out(`Applied ${id} (batch ${result.batch})`));
        }
        const stillPending = pendingMigrations(db, migrationsDir).map((m) => m.id);
        if (stillPending.length) {
            out(`Seed skipped: still pending ${stillPending.join(", ")}`);
        } else if (args.seed) {
            seed(db, { adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD, log: err });
            out("Seed: done");
        }
        return 0;
    } catch (error) {
        if (error instanceof MigrationError) {
            err(`Error: ${error.message}`);
            return 1;
        }
        throw error;
    } finally {
        db?.close();
    }
};
