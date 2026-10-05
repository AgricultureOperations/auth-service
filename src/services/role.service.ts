import crypto from "node:crypto";
import { RoleRepository } from "../repositories/role.repository";
import { PermissionRepository } from "../repositories/permission.repository";
import { UserRepository } from "../repositories/user.repository";
import { inTransaction } from "../repositories/transaction";
import { RoleDto, RoleRow, toRoleDto } from "../models/role.model";
import { AppError } from "../utils/AppError";
import { ADMIN_ROLE } from "../data/seed";

const ROLE_KEY = /^[a-z][a-z0-9_]{1,49}$/;

// "Coordinador de Admisión" -> "coordinador_de_admision" (same idea as the reference's Identificador).
export const slugify = (name: string) =>
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

export class RoleService {
    private roleRepository = new RoleRepository();
    private permissionRepository = new PermissionRepository();
    private userRepository = new UserRepository();

    list(filter: { search?: string; isActive?: boolean }): RoleDto[] {
        return this.roleRepository.findMany(filter).map((row) => this.toDto(row));
    }

    get(id: string): RoleDto {
        return this.toDto(this.findOrThrow(id));
    }

    create({ name, key, description }: { name: string; key?: string; description?: string }): RoleDto {
        const roleKey = key ?? slugify(name);
        if (!ROLE_KEY.test(roleKey)) {
            throw new AppError("key must be 2-50 characters: lowercase letters, digits and _, starting with a letter", 400);
        }
        return inTransaction(() => {
            if (this.roleRepository.findByKey(roleKey)) throw new AppError(`A role with key "${roleKey}" already exists`, 409);
            if (this.roleRepository.findByName(name)) throw new AppError("A role with this name already exists", 409);
            const id = crypto.randomUUID();
            this.roleRepository.create({ id, key: roleKey, name, description: description ?? null });
            return this.get(id);
        });
    }

    update(id: string, changes: { name?: string; description?: string; isActive?: boolean }): RoleDto {
        return inTransaction(() => {
            const role = this.findOrThrow(id);
            if (changes.name && this.roleRepository.findByName(changes.name, id)) {
                throw new AppError("A role with this name already exists", 409);
            }
            if (changes.isActive === false && role.is_active === 1) {
                if (role.is_system) throw new AppError("System roles can't be deactivated", 409);
                if (role.user_count > 0) throw new AppError("Reassign this role's users before deactivating it", 409);
            }
            this.roleRepository.update(id, changes);
            return this.get(id);
        });
    }

    setPermissions(id: string, permissionIds: string[], actorId: string): RoleDto {
        return inTransaction(() => {
            const role = this.findOrThrow(id);
            const all = new Set(this.permissionRepository.allIds());
            const unknown = permissionIds.filter((pid) => !all.has(pid));
            if (unknown.length) throw new AppError(`Unknown permission id(s): ${unknown.join(", ")}`, 400);
            if (role.key === ADMIN_ROLE && permissionIds.length < all.size) {
                throw new AppError("The admin role's permissions can't be reduced", 409);
            }
            const before = this.roleRepository.permissionIds(id);
            const changed = before.length !== permissionIds.length || permissionIds.some((pid) => !before.includes(pid));
            if (changed) {
                this.roleRepository.replacePermissions(id, permissionIds, actorId);
                // Tokens carry the permission list, so every holder of this role must log in again.
                this.userRepository.bumpTokenVersionForRole(id);
            }
            return this.get(id);
        });
    }

    delete(id: string): void {
        inTransaction(() => {
            const role = this.findOrThrow(id);
            if (role.is_system) throw new AppError("System roles can't be deleted", 409);
            if (role.user_count > 0) throw new AppError("Reassign this role's users before deleting it", 409);
            this.roleRepository.delete(id);
        });
    }

    private findOrThrow(id: string): RoleRow {
        const role = this.roleRepository.findById(id);
        if (!role) throw new AppError("Role not found", 404);
        return role;
    }

    private toDto(row: RoleRow): RoleDto {
        return toRoleDto(row, this.roleRepository.permissionIds(row.id));
    }
}
