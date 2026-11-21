import type { Database } from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// SQL migrations in <service>/migrations, applied only by scripts/migration.js (never on startup).
// Every run is recorded in migration_history: who ran it, where, when, how long it took, and the file's checksum.

/** <service>/migrations, from both src/data (ts-node, jest) and dist/data (the image). */
export const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

const FILE_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LEGACY_USER = "legacy:schema_migrations";

export interface MigrationFile {
    id: string;        // file name without .sql, e.g. "004_add_user_locale"
    file: string;      // absolute path
    sql: string;
    checksum: string;  // sha256 of the file with LF line endings
}

export interface HistoryRow {
    id: number;
    migration: string;
    checksum: string;
    batch: number;
    status: "applied" | "failed";
    applied_by: string;
    app_env: string;
    hostname: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    backup_file: string | null;
    error: string | null;
}

export type MigrationState = "applied" | "pending" | "changed" | "missing";

export interface StatusRow {
    id: string;
    state: MigrationState;  // changed: the file differs from what ran; missing: ran, but the file is gone
    record?: HistoryRow;
}

export interface RunOptions {
    user: string;
    appEnv: string;
    hostname?: string;
    dir?: string;
    /** Apply only this migration (a path to its .sql file, or its id). It must be the next pending one. */
    only?: string;
    /** Folder for the SQLite copy taken before the first migration; null skips the backup. */
    backupDir: string | null;
    now?: () => Date;
}

export interface RunResult {
    batch: number | null;
    applied: string[];
    backupFile: string | null;
}

export class MigrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MigrationError";
    }
}

export const checksumOf = (sql: string) =>
    crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

/** Every migration file, in order. Rejects names that don't follow NNN_snake_case.sql and repeated numbers. */
export const loadMigrations = (dir = MIGRATIONS_DIR): MigrationFile[] => {
    if (!fs.existsSync(dir)) throw new MigrationError(`Migrations folder not found: ${dir}`);
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const numbers = new Map<string, string>();
    return files.map((name) => {
        const match = FILE_NAME.exec(name);
        if (!match) throw new MigrationError(`Invalid migration file name "${name}": use NNN_snake_case.sql`);
        const other = numbers.get(match[1]);
        if (other) throw new MigrationError(`Migrations ${other} and ${name} share the number ${match[1]}`);
        numbers.set(match[1], name);
        const file = path.join(dir, name);
        const sql = fs.readFileSync(file, "utf8");
        return { id: name.slice(0, -".sql".length), file, sql, checksum: checksumOf(sql) };
    });
};

const tableExists = (db: Database, name: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/**
 * Applied migrations by id, without writing anything (safe for the server and /health). Before the first
 * command run, a database migrated by the old startup runner only has schema_migrations; those ids count too.
 */
export const appliedMigrations = (db: Database): Map<string, HistoryRow | null> => {
    if (tableExists(db, "migration_history")) {
        const rows = db.prepare("SELECT * FROM migration_history WHERE status = 'applied' ORDER BY id").all() as HistoryRow[];
        return new Map(rows.map((row) => [row.migration, row]));
    }
    if (tableExists(db, "schema_migrations")) {
        const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: string }[];
        return new Map(rows.map((row) => [row.id, null]));
    }
    return new Map();
};

export const pendingMigrations = (db: Database, dir = MIGRATIONS_DIR): MigrationFile[] => {
    const applied = appliedMigrations(db);
    return loadMigrations(dir).filter((m) => !applied.has(m.id));
};

export const migrationStatus = (db: Database, dir = MIGRATIONS_DIR): StatusRow[] => {
    const applied = appliedMigrations(db);
    const files = loadMigrations(dir);
    const rows: StatusRow[] = files.map((m) => {
        if (!applied.has(m.id)) return { id: m.id, state: "pending" };
        const record = applied.get(m.id) ?? undefined;
        return { id: m.id, state: record && record.checksum !== m.checksum ? "changed" : "applied", record };
    });
    const onDisk = new Set(files.map((m) => m.id));
    for (const [id, record] of applied) {
        if (!onDisk.has(id)) rows.push({ id, state: "missing", record: record ?? undefined });
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id));
};

/** Every attempt (applied and failed), newest first. */
export const migrationHistory = (db: Database, limit = 100): HistoryRow[] =>
    tableExists(db, "migration_history")
        ? (db.prepare("SELECT * FROM migration_history ORDER BY id DESC LIMIT ?").all(limit) as HistoryRow[])
        : [];

/**
 * Creates migration_history and, on a database the old startup runner migrated, copies its schema_migrations
 * ids in as batch 0 (schema_migrations itself is left in place for an older image).
 */
export const ensureHistoryTable = (db: Database, { appEnv, dir = MIGRATIONS_DIR }: { appEnv: string; dir?: string }) => {
    if (tableExists(db, "migration_history")) return;
    db.transaction(() => {
        db.exec(`
            CREATE TABLE migration_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                migration TEXT NOT NULL,
                checksum TEXT NOT NULL,
                batch INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('applied', 'failed')),
                applied_by TEXT NOT NULL,
                app_env TEXT NOT NULL,
                hostname TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                backup_file TEXT,
                error TEXT
            );
            CREATE UNIQUE INDEX migration_history_applied_unique ON migration_history (migration) WHERE status = 'applied';
        `);
        if (!tableExists(db, "schema_migrations")) return;
        const checksums = new Map(loadMigrations(dir).map((m) => [m.id, m.checksum]));
        const legacy = db.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id").all() as { id: string; applied_at: string }[];
        const insert = db.prepare(`
            INSERT INTO migration_history (migration, checksum, batch, status, applied_by, app_env, hostname, started_at, finished_at, duration_ms)
            VALUES (?, ?, 0, 'applied', ?, ?, 'unknown', ?, ?, 0)
        `);
        legacy.forEach((row) =>
            insert.run(row.id, checksums.get(row.id) ?? "unknown", LEGACY_USER, appEnv, row.applied_at, row.applied_at));
    })();
};

const resolveTarget = (only: string, files: MigrationFile[], dir: string) => {
    const byId = files.find((m) => m.id === only || `${m.id}.sql` === only);
    if (byId) return byId;
    const wanted = path.resolve(only);
    if (path.dirname(wanted) !== path.resolve(dir)) {
        throw new MigrationError(`${only} is not in the migrations folder (${dir})`);
    }
    const target = files.find((m) => m.file === wanted);
    if (!target) throw new MigrationError(`Migration file not found: ${only}`);
    return target;
};

const backupName = (date: Date, firstId: string) =>
    `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-before-${firstId}.db`;

/**
 * Applies the pending migrations in order, each in its own transaction with foreign keys switched off
 * (SQLite ignores the pragma inside a transaction, and table rebuilds need it off). foreign_key_check must
 * come back clean before a migration commits. A failure rolls that migration back, is recorded as
 * 'failed', and stops the run; migrations applied before it in the same batch stay applied.
 */
export const runPending = (db: Database, options: RunOptions): RunResult => {
    const { user, appEnv, hostname = os.hostname(), dir = MIGRATIONS_DIR, only, backupDir, now = () => new Date() } = options;
    if (!user.trim()) throw new MigrationError("A user is required to record who ran the migrations");
    ensureHistoryTable(db, { appEnv, dir });

    const files = loadMigrations(dir);
    const applied = appliedMigrations(db);
    let pending = files.filter((m) => !applied.has(m.id));

    if (only) {
        const target = resolveTarget(only, files, dir);
        const record = applied.get(target.id);
        if (record) throw new MigrationError(`${target.id} was already applied on ${record.finished_at} by ${record.applied_by}`);
        const earlier = pending.filter((m) => m.id < target.id).map((m) => m.id);
        if (earlier.length) throw new MigrationError(`Apply the earlier pending migrations first: ${earlier.join(", ")}`);
        pending = [target];
    }
    if (!pending.length) return { batch: null, applied: [], backupFile: null };

    let backupFile: string | null = null;
    if (backupDir && db.name && db.name !== ":memory:") {
        fs.mkdirSync(backupDir, { recursive: true });
        backupFile = path.join(backupDir, backupName(now(), pending[0].id));
        db.prepare("VACUUM INTO ?").run(backupFile);
    }

    const batch = (db.prepare("SELECT COALESCE(MAX(batch), 0) + 1 AS next FROM migration_history").get() as { next: number }).next;
    const record = db.prepare(`
        INSERT INTO migration_history
            (migration, checksum, batch, status, applied_by, app_env, hostname, started_at, finished_at, duration_ms, backup_file, error)
        VALUES (@migration, @checksum, @batch, @status, @user, @appEnv, @hostname, @startedAt, @finishedAt, @durationMs, @backupFile, @error)
    `);
    const ran: string[] = [];

    for (const migration of pending) {
        const started = now();
        const row = (status: "applied" | "failed", error: string | null) => {
            const finished = now();
            return {
                migration: migration.id, checksum: migration.checksum, batch, status, user, appEnv, hostname, backupFile, error,
                startedAt: started.toISOString(), finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(),
            };
        };
        db.pragma("foreign_keys = OFF");
        try {
            db.transaction(() => {
                db.exec(migration.sql);
                const violations = db.pragma("foreign_key_check") as unknown[];
                if (violations.length) {
                    throw new Error(`left ${violations.length} foreign key violation(s)`);
                }
                record.run(row("applied", null));
            })();
        } catch (error) {
            // Duck-typed: under Jest, better-sqlite3's errors come from another realm and fail `instanceof Error`.
            const message = typeof (error as { message?: unknown })?.message === "string" ? (error as Error).message : String(error);
            record.run(row("failed", message));
            const done = ran.length ? ` Applied before it in batch ${batch}: ${ran.join(", ")}.` : "";
            throw new MigrationError(`${migration.id} failed and was rolled back: ${message}.${done}`);
        } finally {
            db.pragma("foreign_keys = ON");
        }
        ran.push(migration.id);
    }
    return { batch, applied: ran, backupFile };
};
