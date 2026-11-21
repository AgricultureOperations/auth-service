import Database from "better-sqlite3";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { runPending } from "../src/data/migrator";

// The server no longer migrates on startup, so bring the shared test DB (data/$DB_FILE) up to date once,
// through the same code as scripts/migration.js, before any suite imports src/data/database.ts.
export default function globalSetup() {
    dotenv.config({ path: ".env.test", quiet: true });
    const dataDir = path.join(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(path.join(dataDir, process.env.DB_FILE || "database.db"));
    try {
        runPending(db, { user: "jest", appEnv: "TEST", backupDir: null });
    } finally {
        db.close();
    }
}
