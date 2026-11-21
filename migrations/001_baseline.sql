-- 001_baseline: the schema that database.ts created before migrations existed.
-- IF NOT EXISTS makes fresh and pre-migration databases converge on the same starting point.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);
