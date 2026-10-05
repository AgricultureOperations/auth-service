import db from "../data/database";
import { User, UserListFilter, UserWithRoleRow } from "../models/user.model";

// Explicit column list: the password hash is only ever read by findByEmail (login).
const SELECT_WITH_ROLE = `
    SELECT u.id, u.email, u.name, u.is_active, u.token_version, u.created_at, u.updated_at, u.last_login_at,
           r.id AS role_id, r.key AS role_key, r.name AS role_name
    FROM users u JOIN roles r ON r.id = u.role_id
`;

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export class UserRepository {
    create(user: Pick<User, "id" | "email" | "password" | "name" | "role_id">) {
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO users (id, email, password, name, role_id, is_active, token_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
        `).run(user.id, user.email, user.password, user.name, user.role_id, now, now);
        return user;
    }

    findByEmail(email: string): User | undefined {
        return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as User | undefined;
    }

    existsByEmail(email: string): boolean {
        return !!db.prepare(`SELECT 1 FROM users WHERE lower(email) = lower(?)`).get(email);
    }

    findById(id: string): UserWithRoleRow | undefined {
        return db.prepare(`${SELECT_WITH_ROLE} WHERE u.id = ?`).get(id) as UserWithRoleRow | undefined;
    }

    findMany({ search, roleId, isActive, page, pageSize }: UserListFilter): { rows: UserWithRoleRow[]; total: number } {
        const where: string[] = [];
        const params: unknown[] = [];
        if (search) {
            // LIKE is case-insensitive for ASCII in SQLite.
            where.push(`(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`);
            const pattern = `%${escapeLike(search)}%`;
            params.push(pattern, pattern);
        }
        if (roleId) {
            where.push(`u.role_id = ?`);
            params.push(roleId);
        }
        if (isActive !== undefined) {
            where.push(`u.is_active = ?`);
            params.push(isActive ? 1 : 0);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users u ${clause}`).get(...params) as { total: number };
        const rows = db
            .prepare(`${SELECT_WITH_ROLE} ${clause} ORDER BY u.name COLLATE NOCASE, u.email LIMIT ? OFFSET ?`)
            .all(...params, pageSize, (page - 1) * pageSize) as UserWithRoleRow[];
        return { rows, total };
    }

    updateName(id: string, name: string) {
        db.prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`).run(name, new Date().toISOString(), id);
    }

    // Role changes and deactivation invalidate every token issued so far.
    updateRole(id: string, roleId: string) {
        db.prepare(`UPDATE users SET role_id = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
            .run(roleId, new Date().toISOString(), id);
    }

    updateStatus(id: string, isActive: boolean) {
        db.prepare(`
            UPDATE users SET is_active = ?, token_version = token_version + CASE WHEN ? = 0 THEN 1 ELSE 0 END, updated_at = ?
            WHERE id = ?
        `).run(isActive ? 1 : 0, isActive ? 1 : 0, new Date().toISOString(), id);
    }

    bumpTokenVersionForRole(roleId: string) {
        db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE role_id = ?`).run(roleId);
    }

    touchLastLogin(id: string) {
        db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    }

    delete(id: string) {
        db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    }

    countActiveWithRoleKey(roleKey: string): number {
        return (db.prepare(`
            SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = ? AND u.is_active = 1
        `).get(roleKey) as { n: number }).n;
    }
}
