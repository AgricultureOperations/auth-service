import { Router } from "express";
import {
    createUser, deleteUser, getUserById, getUsers, updateUser, updateUserRole, updateUserStatus,
} from "../controllers/user.controller";
import { requirePermission } from "../middlewares/permission.middleware";

// Mounted behind authMiddleware in app.ts.
const userRoutes = Router();

userRoutes.get("", requirePermission("users:view"), getUsers);
userRoutes.post("", requirePermission("users:create"), createUser);
userRoutes.get("/:id", requirePermission("users:view"), getUserById);
userRoutes.patch("/:id", requirePermission("users:edit"), updateUser);
userRoutes.patch("/:id/role", requirePermission("users:edit"), updateUserRole);
userRoutes.patch("/:id/status", requirePermission("users:edit"), updateUserStatus);
userRoutes.delete("/:id", requirePermission("users:delete"), deleteUser);

export default userRoutes;
