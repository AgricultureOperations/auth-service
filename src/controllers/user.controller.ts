import { Request, Response } from "express";
import { UserService } from "../services/user.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import {
    queryBoolean, queryInt, queryString, queryUuid, requireBoolean, requireBody, requireEmail, requireString, requireUuid,
} from "../utils/validation";
import { MIN_PASSWORD_LENGTH } from "../data/seed";

const userService = new UserService();

type IdParams = Request<{ id: string }>;

export const getUsers = asyncHandler(async (req: Request, resp: Response) => {
    resp.status(200).json(userService.list({
        search: queryString(req.query.search, "search"),
        roleId: queryUuid(req.query.roleId, "roleId"),
        isActive: queryBoolean(req.query.isActive, "isActive"),
        page: queryInt(req.query.page, "page", { min: 1, max: 100000, fallback: 1 }),
        pageSize: queryInt(req.query.pageSize, "pageSize", { min: 1, max: 100, fallback: 10 }),
    }));
});

export const getUserById = asyncHandler(async (req: IdParams, resp: Response) => {
    resp.status(200).json(userService.get(requireUuid(req.params.id, "id")));
});

export const createUser = asyncHandler(async (req: Request, resp: Response) => {
    const body = requireBody(req.body, ["name", "email", "password", "roleId"]);
    const user = await userService.create({
        name: requireString(body.name, "name", { max: 120 }),
        email: requireEmail(body.email),
        password: requireString(body.password, "password", { min: MIN_PASSWORD_LENGTH, max: 128 }),
        roleId: requireUuid(body.roleId, "roleId"),
    });
    resp.status(201).json(user);
});

export const updateUser = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    if (req.body && typeof req.body === "object" && "email" in req.body) throw new AppError("email can't be changed", 400);
    const body = requireBody(req.body, ["name"]);
    resp.status(200).json(userService.updateName(id, requireString(body.name, "name", { max: 120 })));
});

export const updateUserRole = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    const body = requireBody(req.body, ["roleId"]);
    resp.status(200).json(userService.changeRole(id, requireUuid(body.roleId, "roleId")));
});

export const updateUserStatus = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    const body = requireBody(req.body, ["isActive"]);
    resp.status(200).json(userService.setStatus(id, requireBoolean(body.isActive, "isActive")));
});

export const deleteUser = asyncHandler(async (req: IdParams, resp: Response) => {
    userService.delete(requireUuid(req.params.id, "id"));
    resp.status(204).end();
});
