import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { getAuth } from "../middlewares/auth.middleware";
import { AppError } from "../utils/AppError";
import { optionalPhone, optionalTaxId, requireEmail, requireString } from "../utils/validation";
import { MIN_PASSWORD_LENGTH } from "../data/seed";

const authService = new AuthService();

// Public self-registration (customer portal). Only these fields are read; anything else in the body
// (e.g. a role) is ignored, because the account is always a customer.
export const register = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("Request body must be a JSON object", 400);
    }
    const user = await authService.register({
        email: requireEmail(body.email),
        password: requireString(body.password, "password", { min: MIN_PASSWORD_LENGTH, max: 128 }),
        name: body.name === undefined ? undefined : requireString(body.name, "name", { min: 2, max: 120 }),
        taxId: optionalTaxId(body.taxId) ?? null,
        phone: optionalPhone(body.phone) ?? null,
    });
    res.status(201).json(user);
});

export const login = asyncHandler(async (req: Request,resp: Response) => {
    const result = await authService.login(req.body.email,req.body.password);
    resp.json(result);
});

export const me = asyncHandler(async (req: Request, resp: Response) => {
    resp.json(authService.me(getAuth(resp).userId));
});
