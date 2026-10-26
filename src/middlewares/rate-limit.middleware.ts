import rateLimit from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Public auth endpoints (login, register) are reachable from the internet through the customer portal.
// Limits are per client IP over 15 minutes and answer 429 with the usual { status, message } body.
// Jest runs hundreds of logins against the same app, so the limiter is off under NODE_ENV=test
// (the rate-limit test builds its own limiter).
export const authRateLimit = ({ limit, skip = process.env.NODE_ENV === "test" }: { limit: number; skip?: boolean }) =>
    rateLimit({
        windowMs: FIFTEEN_MINUTES,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skip: () => skip,
        message: { status: "error", message: "Too many attempts. Try again in a few minutes." },
    });

export const loginRateLimit = authRateLimit({ limit: Number(process.env.LOGIN_RATE_LIMIT) || 20 });
export const registerRateLimit = authRateLimit({ limit: Number(process.env.REGISTER_RATE_LIMIT) || 10 });
