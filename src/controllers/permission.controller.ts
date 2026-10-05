import { Request, Response } from "express";
import { PermissionService } from "../services/permission.service";
import { asyncHandler } from "../utils/asyncHandler";

const permissionService = new PermissionService();

export const getPermissions = asyncHandler(async (req: Request, resp: Response) => {
    resp.status(200).json(permissionService.matrix());
});
