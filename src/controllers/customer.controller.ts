import { Request, Response } from "express";
import { CustomerService } from "../services/customer.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { queryBoolean, queryInt, queryString, requireBody, requireEmail, requireString, requireUuid } from "../utils/validation";

const customerService = new CustomerService();

type IdParams = Request<{ id: string }>;

// Same rule as order-service's CustomerSnapshot: cédula, RUC or passport. Stored upper-cased.
const TAX_ID = /^[A-Za-z0-9-]{5,20}$/;

// undefined = not sent (keep), null or "" = clear.
const optionalTaxId = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === "string" && value.trim() === "")) return null;
    if (typeof value !== "string" || !TAX_ID.test(value.trim())) {
        throw new AppError("taxId must be 5 to 20 letters, digits or dashes", 400);
    }
    return value.trim().toUpperCase();
};

const optionalPhone = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === "string" && value.trim() === "")) return null;
    return requireString(value, "phone", { max: 30 });
};

export const getCustomers = asyncHandler(async (req: Request, resp: Response) => {
    resp.status(200).json(customerService.list({
        search: queryString(req.query.search, "search"),
        isActive: queryBoolean(req.query.isActive, "isActive"),
        page: queryInt(req.query.page, "page", { min: 1, max: 100000, fallback: 1 }),
        pageSize: queryInt(req.query.pageSize, "pageSize", { min: 1, max: 100, fallback: 10 }),
    }));
});

export const getCustomerById = asyncHandler(async (req: IdParams, resp: Response) => {
    resp.status(200).json(customerService.get(requireUuid(req.params.id, "id")));
});

export const createCustomer = asyncHandler(async (req: Request, resp: Response) => {
    const body = requireBody(req.body, ["name", "email", "taxId", "phone"]);
    const customer = await customerService.create({
        name: requireString(body.name, "name", { min: 2, max: 120 }),
        email: requireEmail(body.email),
        taxId: optionalTaxId(body.taxId) ?? null,
        phone: optionalPhone(body.phone) ?? null,
    });
    resp.status(201).json(customer);
});

export const updateCustomer = asyncHandler(async (req: IdParams, resp: Response) => {
    const id = requireUuid(req.params.id, "id");
    if (req.body && typeof req.body === "object" && "email" in req.body) throw new AppError("email can't be changed", 400);
    const body = requireBody(req.body, ["name", "taxId", "phone"]);
    resp.status(200).json(customerService.update(id, {
        name: body.name === undefined ? undefined : requireString(body.name, "name", { min: 2, max: 120 }),
        taxId: optionalTaxId(body.taxId),
        phone: optionalPhone(body.phone),
    }));
});
