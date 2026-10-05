export interface RoleRow {
    id: string;
    key: string;
    name: string;
    description: string | null;
    is_system: number;
    is_active: number;
    created_at: string;
    updated_at: string;
    user_count: number;
}

export interface RoleDto {
    id: string;
    key: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    isActive: boolean;
    userCount: number;
    permissionIds: string[];
    createdAt: string;
    updatedAt: string;
}

export const toRoleDto = (row: RoleRow, permissionIds: string[]): RoleDto => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.is_system === 1,
    isActive: row.is_active === 1,
    userCount: row.user_count,
    permissionIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});
