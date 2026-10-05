import { Request, Response } from "express";
import { RoleService } from "../services/role.service";
import { asyncHandler } from "../utils/asyncHandler";
import { getAuth } from "../middlewares/auth.middleware";
import {
    optionalString, queryBoolean, queryString, requireBoolean, requireBody, requireString, requireUuid, requireUuidArray,
} from "../utils/validation";

const roleService = new RoleService();

type IdParams = Request<{ id: string }>;

export const getRoles = asyncHandler(async (req: Request, resp: Response) => {
    resp.status(200).json(roleService.list({
        search: queryString(req.query.search, "search"),
        isActive: queryBoolean(req.query.isActive, "isActive"),
    }));
});

export const getRoleById = asyncHandler(async (req: IdParams, resp: Response) => {
    resp.status(200).json(roleService.get(requireUuid(req.params.id, "id")));
});

export const createRole = asyncHandler(async (req: Request, resp: Response) => {
    const body = requireBody(req.body, ["name", "key", "description"]);
    const role = roleService.create({
        name: requireString(body.name, "name", { max: 80 }),
        key: optionalString(body.key, "key", { max: 50 }),
        description: optionalString(body.description, "description", { min: 0, max: 255 }),
    });
    resp.status(201).json(role);
});

export const updateRole = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    const body = requireBody(req.body, ["name", "description", "isActive"]);
    resp.status(200).json(roleService.update(id, {
        name: optionalString(body.name, "name", { max: 80 }),
        description: optionalString(body.description, "description", { min: 0, max: 255 }),
        isActive: body.isActive === undefined ? undefined : requireBoolean(body.isActive, "isActive"),
    }));
});

export const setRolePermissions = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    const body = requireBody(req.body, ["permissionIds"]);
    const permissionIds = requireUuidArray(body.permissionIds, "permissionIds");
    resp.status(200).json(roleService.setPermissions(id, permissionIds, getAuth(resp).userId));
});

export const deleteRole = asyncHandler(async (req: IdParams, resp: Response) => {
    roleService.delete(requireUuid(req.params.id, "id"));
    resp.status(204).end();
});
