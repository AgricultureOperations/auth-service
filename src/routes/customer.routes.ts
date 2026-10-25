import { Router } from "express";
import { createCustomer, getCustomerById, getCustomers, updateCustomer } from "../controllers/customer.controller";
import { requirePermission } from "../middlewares/permission.middleware";

// Mounted behind authMiddleware in app.ts. Deactivating or deleting a customer goes through /user (users:edit|delete).
const customerRoutes = Router();

customerRoutes.get("", requirePermission("customers:view"), getCustomers);
customerRoutes.post("", requirePermission("customers:create"), createCustomer);
customerRoutes.get("/:id", requirePermission("customers:view"), getCustomerById);
customerRoutes.patch("/:id", requirePermission("customers:edit"), updateCustomer);

export default customerRoutes;
