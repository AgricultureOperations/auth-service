import db from "../data/database";
import { ActionDto, PermissionRow } from "../models/permission.model";

export class PermissionRepository {
    findAll(): PermissionRow[] {
        return db.prepare(`
            SELECT p.id, p.code,
                   r.id AS resource_id, r.key AS resource_key, r.name AS resource_name,
                   r.description AS resource_description, r.sort_order AS resource_sort_order,
                   a.id AS action_id, a.key AS action_key
            FROM permissions p
            JOIN resources r ON r.id = p.resource_id
            JOIN actions a ON a.id = p.action_id
            ORDER BY r.sort_order, r.key, a.rowid
        `).all() as PermissionRow[];
    }

    findActions(): ActionDto[] {
        return db.prepare(`SELECT id, key, name FROM actions ORDER BY rowid`).all() as ActionDto[];
    }

    allIds(): string[] {
        return (db.prepare(`SELECT id FROM permissions`).all() as { id: string }[]).map((r) => r.id);
    }
}
