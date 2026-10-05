export interface PermissionRow {
    id: string;
    code: string;
    resource_id: string;
    resource_key: string;
    resource_name: string;
    resource_description: string | null;
    resource_sort_order: number;
    action_id: string;
    action_key: string;
}

export interface ActionDto {
    id: string;
    key: string;
    name: string;
}

// GET /permissions: rows = resources, columns = actions, ready for a role × permission matrix.
export interface PermissionMatrixDto {
    actions: ActionDto[];
    resources: {
        id: string;
        key: string;
        name: string;
        description: string | null;
        sortOrder: number;
        permissions: { id: string; code: string; actionId: string; actionKey: string }[];
    }[];
}
