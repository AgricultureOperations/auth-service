import Database from "better-sqlite3";
import path from "node:path";
import fs from "fs"
/*
const dbFile = process.env.DB_FILE || "database.db";
const db = new Database(dbFile);*/
const dbFileName = process.env.DB_FILE || "database.db";

// ensure data folder exists
const dataDir = path.join(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, dbFileName);

const db = new Database(dbPath);


db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
`);
export default db;