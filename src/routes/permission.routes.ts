import { Router } from "express";
import { getPermissions } from "../controllers/permission.controller";
import { requirePermission } from "../middlewares/permission.middleware";

// Mounted behind authMiddleware in app.ts.
const permissionRoutes = Router();

permissionRoutes.get("", requirePermission("roles:view"), getPermissions);

export default permissionRoutes;
