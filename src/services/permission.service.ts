import { PermissionRepository } from "../repositories/permission.repository";
import { PermissionMatrixDto } from "../models/permission.model";

export class PermissionService {
    private permissionRepository = new PermissionRepository();

    // Grouped by resource (rows) with the action list (columns), for the Roles & Permissions matrix.
    matrix(): PermissionMatrixDto {
        const resources = new Map<string, PermissionMatrixDto["resources"][number]>();
        for (const p of this.permissionRepository.findAll()) {
            if (!resources.has(p.resource_id)) {
                resources.set(p.resource_id, {
                    id: p.resource_id,
                    key: p.resource_key,
                    name: p.resource_name,
                    description: p.resource_description,
                    sortOrder: p.resource_sort_order,
                    permissions: [],
                });
            }
            resources.get(p.resource_id)!.permissions.push({ id: p.id, code: p.code, actionId: p.action_id, actionKey: p.action_key });
        }
        return { actions: this.permissionRepository.findActions(), resources: [...resources.values()] };
    }
}
