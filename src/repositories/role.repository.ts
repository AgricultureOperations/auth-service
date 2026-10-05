import db from "../data/database";
import { RoleRow } from "../models/role.model";
import { escapeLike } from "./user.repository";

const SELECT_ROLE = `
    SELECT r.id, r.key, r.name, r.description, r.is_system, r.is_active, r.created_at, r.updated_at,
           (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
    FROM roles r
`;

export class RoleRepository {
    findById(id: string): RoleRow | undefined {
        return db.prepare(`${SELECT_ROLE} WHERE r.id = ?`).get(id) as RoleRow | undefined;
    }

    findByKey(key: string): RoleRow | undefined {
        return db.prepare(`${SELECT_ROLE} WHERE r.key = ?`).get(key) as RoleRow | undefined;
    }

    // Name uniqueness is case-insensitive; exceptId skips the role being renamed.
    findByName(name: string, exceptId?: string): RoleRow | undefined {
        return db.prepare(`${SELECT_ROLE} WHERE lower(r.name) = lower(?) AND r.id IS NOT ?`)
            .get(name, exceptId ?? null) as RoleRow | undefined;
    }

    findMany({ search, isActive }: { search?: string; isActive?: boolean }): RoleRow[] {
        const where: string[] = [];
        const params: unknown[] = [];
        if (search) {
            where.push(`(r.name LIKE ? ESCAPE '\\' OR r.key LIKE ? ESCAPE '\\')`);
            const pattern = `%${escapeLike(search)}%`;
            params.push(pattern, pattern);
        }
        if (isActive !== undefined) {
            where.push(`r.is_active = ?`);
            params.push(isActive ? 1 : 0);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        return db.prepare(`${SELECT_ROLE} ${clause} ORDER BY r.is_system DESC, r.name COLLATE NOCASE`).all(...params) as RoleRow[];
    }

    create(role: { id: string; key: string; name: string; description: string | null }) {
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO roles (id, key, name, description, is_system, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 1, ?, ?)
        `).run(role.id, role.key, role.name, role.description, now, now);
    }

    update(id: string, changes: { name?: string; description?: string | null; isActive?: boolean }) {
        const current = this.findById(id)!;
        db.prepare(`UPDATE roles SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`).run(
            changes.name ?? current.name,
            changes.description === undefined ? current.description : changes.description,
            changes.isActive === undefined ? current.is_active : changes.isActive ? 1 : 0,
            new Date().toISOString(),
            id
        );
    }

    delete(id: string) {
        db.prepare(`DELETE FROM roles WHERE id = ?`).run(id);
    }

    permissionIds(roleId: string): string[] {
        return (db.prepare(`
            SELECT rp.permission_id AS id FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = ? ORDER BY p.code
        `).all(roleId) as { id: string }[]).map((r) => r.id);
    }

    permissionCodes(roleId: string): string[] {
        return (db.prepare(`
            SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = ? ORDER BY p.code
        `).all(roleId) as { code: string }[]).map((r) => r.code);
    }

    // Replaces the role's grants; retained rows keep their original granted_at/granted_by.
    replacePermissions(roleId: string, permissionIds: string[], grantedBy: string) {
        const keep = JSON.stringify(permissionIds);
        db.prepare(`DELETE FROM role_permissions WHERE role_id = ? AND permission_id NOT IN (SELECT value FROM json_each(?))`)
            .run(roleId, keep);
        const insert = db.prepare(`
            INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at, granted_by) VALUES (?, ?, ?, ?)
        `);
        const now = new Date().toISOString();
        permissionIds.forEach((pid) => insert.run(roleId, pid, now, grantedBy));
    }
}
