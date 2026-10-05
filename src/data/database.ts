import Database from "better-sqlite3";
import path from "node:path";
import fs from "fs"
import { runMigrations } from "./migrate";
import { seed } from "./seed";

const dbFileName = process.env.DB_FILE || "database.db";

// ensure data folder exists
const dataDir = path.join(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, dbFileName);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// Schema changes go in src/data/migrations/, never here: they run once per database, on startup.
const applied = runMigrations(db);
if (applied.length) console.log(`[db] Applied migrations: ${applied.join(", ")}`);
seed(db, { adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD });

export default db;
