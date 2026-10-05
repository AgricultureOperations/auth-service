import dotenv from "dotenv";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

dotenv.config();

const SECRET = process.env.JWT_SECRET!;
const ISSUER = process.env.JWT_ISSUER!;
const AUDIENCE = process.env.JWT_AUDIENCE!;
const TIMEEXP = process.env.JWT_TIMEEXP! as SignOptions["expiresIn"];

// Claims read by order-service and product-service (Phase 2). Adding a claim is additive; never remove one.
export interface TokenClaims {
    sub: string;
    id: string; // same as sub; kept for consumers of the original { id, email } payload
    email: string;
    role: string; // role key, e.g. "admin"
    permissions: string[]; // e.g. ["orders:view", "products:edit"]
    tv: number; // users.token_version at issue time
}

export const generateToken = (payload: TokenClaims): string =>{
    return jwt.sign(payload, SECRET, {
        expiresIn: TIMEEXP,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: "HS256",
    })
}

// Throws on a bad signature, expiry, wrong issuer/audience or algorithm.
export const verifyToken = (token: string): JwtPayload & Partial<TokenClaims> => {
    const payload = jwt.verify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload === "string") throw new Error("Unexpected token payload");
    return payload;
}
