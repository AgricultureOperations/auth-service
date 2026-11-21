import Database from "better-sqlite3";
import path from "node:path";
import fs from "fs"
import { pendingMigrations } from "./migrator";
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
// scripts/migration.js may hold the write lock while it migrates this file.
db.pragma("busy_timeout = 5000");

/** Migrations in migrations/ not yet applied to this database. Read-only; GET /api/v1/health reports the count. */
export const pendingMigrationIds = () => pendingMigrations(db).map((m) => m.id);

// Schema changes are applied only by scripts/migration.js, never on startup. With migrations pending the server
// still starts (so a Render Shell can reach the container), but the seed waits: it needs the full schema.
const pending = pendingMigrationIds();
if (pending.length) {
  console.error(
    `[db] ${pending.length} pending migration(s): ${pending.join(", ")}. ` +
    "Requests that need them will fail until you run: node scripts/migration.js up (see --help)"
  );
} else {
  seed(db, { adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD });
}

export default db;
