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
    tax_id: string | null;
    phone: string | null;
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
    tax_id: string | null;
    phone: string | null;
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
    // Customer data (cédula/RUC, phone); null for back-office users.
    taxId: string | null;
    phone: string | null;
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
    taxId: row.tax_id,
    phone: row.phone,
});

// GET/POST/PATCH /customers: a user with the customer role, without back-office fields.
export interface CustomerDto {
    id: string;
    name: string;
    email: string;
    taxId: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export const toCustomerDto = (row: UserWithRoleRow): CustomerDto => ({
    id: row.id,
    name: row.name,
    email: row.email,
    taxId: row.tax_id,
    phone: row.phone,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export interface UserListFilter {
    search?: string;
    roleId?: string;
    // Role by key (e.g. "customer"), for /customers.
    roleKey?: string;
    isActive?: boolean;
    page: number;
    pageSize: number;
}

export interface Paginated<T> {
    data: T[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
}
