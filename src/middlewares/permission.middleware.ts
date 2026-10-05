import { NextFunction, Request, Response } from "express";
import { getAuth } from "./auth.middleware";

// Run after authMiddleware. 403 = authenticated but not allowed (the frontend keeps the session).
const forbidden = (resp: Response) => resp.status(403).json({ status: "error", message: "You don't have permission to do this" });

export const requirePermission = (code: string) => (req: Request, resp: Response, next: NextFunction) =>
    getAuth(resp).permissions.includes(code) ? next() : forbidden(resp);

export const requireRole = (roleKey: string) => (req: Request, resp: Response, next: NextFunction) =>
    getAuth(resp).roleKey === roleKey ? next() : forbidden(resp);
