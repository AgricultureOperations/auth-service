import type { Database } from "better-sqlite3";
import { migrations } from "./migrations";

export interface Migration {
    id: string;
    up: (db: Database) => void;
}

/**
 * Applies every migration not yet recorded in schema_migrations, in order, each in its own transaction.
 * Foreign keys are switched off around each migration (SQLite ignores the pragma inside a transaction)
 * so table rebuilds work; foreign_key_check must come back clean before the transaction commits.
 */
export const runMigrations = (db: Database, list: Migration[] = migrations): string[] => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const applied = new Set(
        (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((row) => row.id)
    );
    const ran: string[] = [];

    for (const migration of list) {
        if (applied.has(migration.id)) continue;
        db.pragma("foreign_keys = OFF");
        try {
            db.transaction(() => {
                migration.up(db);
                const violations = db.pragma("foreign_key_check") as unknown[];
                if (violations.length) {
                    throw new Error(`Migration ${migration.id} left ${violations.length} foreign key violation(s)`);
                }
                db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
                    .run(migration.id, new Date().toISOString());
            })();
        } finally {
            db.pragma("foreign_keys = ON");
        }
        ran.push(migration.id);
    }
    return ran;
};
