import db from "../data/database";

// Runs fn in one SQLite transaction (better-sqlite3 is synchronous, so check-then-write inside is race-free).
export const inTransaction = <T>(fn: () => T): T => db.transaction(fn)();
