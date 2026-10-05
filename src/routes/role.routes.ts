import { Router } from "express";
import { createRole, deleteRole, getRoleById, getRoles, setRolePermissions, updateRole } from "../controllers/role.controller";
import { requirePermission } from "../middlewares/permission.middleware";

// Mounted behind authMiddleware in app.ts.
const roleRoutes = Router();

roleRoutes.get("", requirePermission("roles:view"), getRoles);
roleRoutes.post("", requirePermission("roles:create"), createRole);
roleRoutes.get("/:id", requirePermission("roles:view"), getRoleById);
roleRoutes.patch("/:id", requirePermission("roles:edit"), updateRole);
roleRoutes.put("/:id/permissions", requirePermission("roles:edit"), setRolePermissions);
roleRoutes.delete("/:id", requirePermission("roles:delete"), deleteRole);

export default roleRoutes;
