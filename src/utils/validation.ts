import { AppError } from "./AppError";

// Request validation helpers. Each one throws AppError(..., 400) so controllers stay one-liners.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_V4.test(value);

export const requireUuid = (value: unknown, field: string): string => {
    if (!isUuid(value)) throw new AppError(`${field} must be a valid UUID`, 400);
    return value;
};

export type Body = Record<string, unknown>;

export const requireBody = (body: unknown, allowed: string[]): Body => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("Request body must be a JSON object", 400);
    }
    const unknownFields = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unknownFields.length) throw new AppError(`Unknown field(s): ${unknownFields.join(", ")}`, 400);
    return body as Body;
};

export const requireString = (value: unknown, field: string, { min = 1, max = 255 } = {}): string => {
    if (typeof value !== "string") throw new AppError(`${field} is required`, 400);
    const trimmed = value.trim();
    if (trimmed.length < min) throw new AppError(`${field} must be at least ${min} characters`, 400);
    if (trimmed.length > max) throw new AppError(`${field} must be at most ${max} characters`, 400);
    return trimmed;
};

export const optionalString = (value: unknown, field: string, opts?: { min?: number; max?: number }) =>
    value === undefined ? undefined : requireString(value, field, opts);

export const requireEmail = (value: unknown): string => {
    const email = requireString(value, "email", { max: 254 });
    if (!EMAIL.test(email)) throw new AppError("email must be a valid email address", 400);
    return email;
};

export const requireBoolean = (value: unknown, field: string): boolean => {
    if (typeof value !== "boolean") throw new AppError(`${field} must be a boolean`, 400);
    return value;
};

export const requireUuidArray = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) throw new AppError(`${field} must be an array of UUIDs`, 400);
    value.forEach((item, i) => requireUuid(item, `${field}[${i}]`));
    return [...new Set(value as string[])];
};

// Query strings arrive as strings (or arrays when repeated).
const queryValue = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export const queryBoolean = (value: unknown, field: string): boolean | undefined => {
    const raw = queryValue(value);
    if (raw === undefined) return undefined;
    if (raw !== "true" && raw !== "false") throw new AppError(`${field} must be true or false`, 400);
    return raw === "true";
};

export const queryInt = (value: unknown, field: string, { min, max, fallback }: { min: number; max: number; fallback: number }): number => {
    const raw = queryValue(value);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${field} must be an integer between ${min} and ${max}`, 400);
    return n;
};

export const queryString = (value: unknown, field: string): string | undefined => {
    const raw = queryValue(value);
    if (raw !== undefined && raw.length > 100) throw new AppError(`${field} must be at most 100 characters`, 400);
    return raw?.trim() || undefined;
};

export const queryUuid = (value: unknown, field: string): string | undefined => {
    const raw = queryValue(value);
    return raw === undefined ? undefined : requireUuid(raw, field);
};
