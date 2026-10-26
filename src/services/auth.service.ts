import bcrypt from "bcrypt"
import crypto from "node:crypto";
import { generateToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { UserRepository } from "../repositories/user.repository";
import { RoleRepository } from "../repositories/role.repository";
import { toUserDto, UserWithRoleRow } from "../models/user.model";
import { CUSTOMER_ROLE } from "../data/seed";
import { inTransaction } from "../repositories/transaction";

export interface RegisterInput {
    email: string;
    password: string;
    name?: string;
    taxId: string | null;
    phone: string | null;
}

export class AuthService {
    private userRepository = new UserRepository();
    private roleRepository = new RoleRepository();

    // Public self-registration (the customer portal) always creates a customer, whatever the body says:
    // customers have no back-office permissions. Staff accounts are created by an admin through /user.
    async register({ email, password, name, taxId, phone }: RegisterInput) {
        const hashed = await bcrypt.hash(password, 10);
        return inTransaction(() => {
            const role = this.roleRepository.findByKey(CUSTOMER_ROLE);
            if (!role || role.is_active !== 1) throw new AppError("The customer role is missing or inactive", 500);
            if (this.userRepository.existsByEmail(email)) throw new AppError("A user with this email already exists", 409);
            if (taxId && this.userRepository.existsByTaxId(taxId)) throw new AppError("A customer with this tax ID already exists", 409);

            const id = crypto.randomUUID();
            this.userRepository.create({
                id,
                email,
                password: hashed,
                name: name ?? email.split("@")[0],
                role_id: role.id,
                tax_id: taxId,
                phone,
            });
            return { id, email };
        });
    }

    async login(email: string, password: string){
        const user = this.userRepository.findByEmail(email);
        if(!user) throw new AppError("Invalid credentials",401);
        const match = await bcrypt.compare(password,user.password);
        if(!match || user.is_active !== 1) throw new AppError("Invalid credentials",401);

        this.userRepository.touchLastLogin(user.id);
        const row = this.userRepository.findById(user.id)!;
        const token = generateToken({
            sub: row.id,
            id: row.id,
            email: row.email,
            role: row.role_key,
            permissions: this.roleRepository.permissionCodes(row.role_id),
            tv: row.token_version,
        });

        return {token};
    }

    me(userId: string) {
        const row = this.userRepository.findById(userId);
        if (!row) throw new AppError("User not found", 404);
        return this.withPermissions(row);
    }

    private withPermissions(row: UserWithRoleRow) {
        return { ...toUserDto(row), permissions: this.roleRepository.permissionCodes(row.role_id) };
    }
}
