import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { getAuth } from "../middlewares/auth.middleware";

const authService = new AuthService();

export const register = asyncHandler(async (req: Request,res: Response) => {
    const user = await authService.register(req.body.email, req.body.password);
    res.status(201).json(user);
});

export const login = asyncHandler(async (req: Request,resp: Response) => {
    const result = await authService.login(req.body.email,req.body.password);
    resp.json(result);
});

export const me = asyncHandler(async (req: Request, resp: Response) => {
    resp.json(authService.me(getAuth(resp).userId));
});
