import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { UserRepository } from "../repositories/user.repository";
import { RoleRepository } from "../repositories/role.repository";

export interface AuthContext {
    userId: string;
    email: string;
    roleKey: string;
    permissions: string[];
}

const userRepository = new UserRepository();
const roleRepository = new RoleRepository();

const unauthorized = (resp: Response, message: string) => resp.status(401).json({ status: "error", message });

// 401 = no, invalid, expired or stale token (the frontend logs out). Permission checks (403) live in
// permission.middleware.ts. Role and permissions are re-read from the DB so they are always current.
export const authMiddleware = (req: Request, resp: Response, next: NextFunction) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) return unauthorized(resp, "Missing bearer token");

    let payload;
    try {
        payload = verifyToken(token);
    } catch {
        return unauthorized(resp, "Invalid or expired token");
    }

    const userId = payload.sub ?? payload.id;
    const user = userId ? userRepository.findById(userId) : undefined;
    if (!user || user.is_active !== 1) return unauthorized(resp, "User is inactive or no longer exists");
    if (payload.tv !== user.token_version) return unauthorized(resp, "Session expired, please log in again");

    const auth: AuthContext = {
        userId: user.id,
        email: user.email,
        roleKey: user.role_key,
        permissions: roleRepository.permissionCodes(user.role_id),
    };
    resp.locals.auth = auth;
    next();
}

export const getAuth = (resp: Response): AuthContext => resp.locals.auth as AuthContext;
