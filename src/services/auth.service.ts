import bcrypt from "bcrypt"
import crypto from "node:crypto";
import { generateToken } from "../utils/jwt";
import { AppError } from "../utils/AppError";
import { UserRepository } from "../repositories/user.repository";
import { RoleRepository } from "../repositories/role.repository";
import { toUserDto, UserWithRoleRow } from "../models/user.model";
import { VIEWER_ROLE } from "../data/seed";

export class AuthService {
    private userRepository = new UserRepository();
    private roleRepository = new RoleRepository();

    // Self-registration always gets the viewer role, whatever the body says.
    async register(email: string, password: string){
        const hashed = await bcrypt.hash(password,10)
        const viewer = this.roleRepository.findByKey(VIEWER_ROLE);
        if (!viewer) throw new AppError("Default role is missing", 500);

        const user = {
            id: crypto.randomUUID(),
            email,
            password: hashed,
            name: typeof email === "string" && email.indexOf("@") > 0 ? email.split("@")[0] : String(email),
            role_id: viewer.id,
        }
        this.userRepository.create(user);

        return { id: user.id, email: user.email}
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
