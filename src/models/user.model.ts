// Row as stored. `password` is a bcrypt hash and never leaves the service layer.
export interface User {
    id: string;
    email: string;
    password: string;
    name: string;
    role_id: string;
    is_active: number;
    token_version: number;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
}

// Row returned by UserRepository's joined reads (no password).
export interface UserWithRoleRow {
    id: string;
    email: string;
    name: string;
    is_active: number;
    token_version: number;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
    role_id: string;
    role_key: string;
    role_name: string;
}

// Public shape (GET /user, /auth/me, ...).
export interface UserDto {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    role: { id: string; key: string; name: string };
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
}

export const toUserDto = (row: UserWithRoleRow): UserDto => ({
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.is_active === 1,
    role: { id: row.role_id, key: row.role_key, name: row.role_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
});

export interface UserListFilter {
    search?: string;
    roleId?: string;
    isActive?: boolean;
    page: number;
    pageSize: number;
}

export interface Paginated<T> {
    data: T[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
}
