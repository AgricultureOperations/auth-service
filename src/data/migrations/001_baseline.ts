import type { Migration } from "../migrate";

// The schema that database.ts created before migrations existed. IF NOT EXISTS makes fresh and
// pre-migration databases converge on the same starting point.
export const baseline: Migration = {
    id: "001_baseline",
    up: (db) => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );
        `);
    },
};
