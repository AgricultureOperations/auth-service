import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { UserRepository } from "../repositories/user.repository";
import { RoleRepository } from "../repositories/role.repository";
import { inTransaction } from "../repositories/transaction";
import { Paginated, toUserDto, UserDto, UserListFilter, UserWithRoleRow } from "../models/user.model";
import { AppError } from "../utils/AppError";
import { ADMIN_ROLE } from "../data/seed";

export interface CreateUserInput {
    name: string;
    email: string;
    password: string;
    roleId: string;
}

export class UserService {
    private userRepository = new UserRepository();
    private roleRepository = new RoleRepository();

    list(filter: UserListFilter): Paginated<UserDto> {
        const { rows, total } = this.userRepository.findMany(filter);
        return {
            data: rows.map(toUserDto),
            meta: { page: filter.page, pageSize: filter.pageSize, total, totalPages: Math.ceil(total / filter.pageSize) },
        };
    }

    get(id: string): UserDto {
        return toUserDto(this.findOrThrow(id));
    }

    async create({ name, email, password, roleId }: CreateUserInput): Promise<UserDto> {
        const hashed = await bcrypt.hash(password, 10);
        return inTransaction(() => {
            this.activeRoleOrThrow(roleId);
            if (this.userRepository.existsByEmail(email)) throw new AppError("A user with this email already exists", 409);
            const id = crypto.randomUUID();
            this.userRepository.create({ id, email, password: hashed, name, role_id: roleId });
            return this.get(id);
        });
    }

    updateName(id: string, name: string): UserDto {
        this.findOrThrow(id);
        this.userRepository.updateName(id, name);
        return this.get(id);
    }

    changeRole(id: string, roleId: string): UserDto {
        return inTransaction(() => {
            const user = this.findOrThrow(id);
            const role = this.activeRoleOrThrow(roleId);
            if (user.role_id === role.id) return toUserDto(user);
            if (role.key !== ADMIN_ROLE) this.assertNotLastAdmin(user, "demote");
            this.userRepository.updateRole(id, roleId);
            return this.get(id);
        });
    }

    setStatus(id: string, isActive: boolean): UserDto {
        return inTransaction(() => {
            const user = this.findOrThrow(id);
            if ((user.is_active === 1) === isActive) return toUserDto(user);
            if (!isActive) this.assertNotLastAdmin(user, "deactivate");
            this.userRepository.updateStatus(id, isActive);
            return this.get(id);
        });
    }

    delete(id: string): void {
        inTransaction(() => {
            const user = this.findOrThrow(id);
            this.assertNotLastAdmin(user, "delete");
            this.userRepository.delete(id);
        });
    }

    private findOrThrow(id: string): UserWithRoleRow {
        const user = this.userRepository.findById(id);
        if (!user) throw new AppError("User not found", 404);
        return user;
    }

    private activeRoleOrThrow(roleId: string) {
        const role = this.roleRepository.findById(roleId);
        if (!role) throw new AppError("Role not found", 404);
        if (role.is_active !== 1) throw new AppError("Role is inactive", 409);
        return role;
    }

    private assertNotLastAdmin(user: UserWithRoleRow, verb: string) {
        if (user.role_key !== ADMIN_ROLE || user.is_active !== 1) return;
        if (this.userRepository.countActiveWithRoleKey(ADMIN_ROLE) <= 1) {
            throw new AppError(`Cannot ${verb} the last active admin`, 409);
        }
    }
}
