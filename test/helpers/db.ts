import bcrypt from "bcrypt";
import crypto from "node:crypto";
import request from "supertest";
import app from "../../src/app";
import db from "../../src/data/database";
import { seed, SYSTEM_ROLES } from "../../src/data/seed";

export const ADMIN = { email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! };
export const PASSWORD = "Password-123";
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Back to a freshly seeded DB: system roles with their default grants, and only the first admin.
export const resetDb = () => {
    db.exec(`
        DELETE FROM role_permissions;
        DELETE FROM users;
        DELETE FROM roles WHERE is_system = 0;
        DELETE FROM seed_history;
    `);
    const restore = db.prepare("UPDATE roles SET name = ?, description = ?, is_active = 1 WHERE key = ?");
    SYSTEM_ROLES.forEach((r) => restore.run(r.name, r.description, r.key));
    seed(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password, log: () => {} });
};

export const roleId = (key: string) => (db.prepare("SELECT id FROM roles WHERE key = ?").get(key) as { id: string }).id;
export const userId = (email: string) => (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

export const login = async (email: string, password = PASSWORD): Promise<string> => {
    const resp = await request(app).post("/api/v1/auth/login").send({ email, password });
    if (resp.status !== 200) throw new Error(`login failed for ${email}: ${resp.status}`);
    return resp.body.token;
};

let counter = 0;
// Inserts a user with the given role (low bcrypt cost keeps tests fast) and logs them in.
export const userWithRole = async (roleKey: string, overrides: { email?: string; name?: string } = {}) => {
    const email = overrides.email ?? `${roleKey}-${++counter}@agriops.test`;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare(`
        INSERT INTO users (id, email, password, name, role_id, is_active, token_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(id, email, bcrypt.hashSync(PASSWORD, 4), overrides.name ?? email.split("@")[0], roleId(roleKey), now, now);
    return { id, email, token: await login(email) };
};

export const adminToken = () => login(ADMIN.email, ADMIN.password);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
