import dotenv from "dotenv";
import jwt, { SignOptions } from "jsonwebtoken";

dotenv.config();

const SECRET = process.env.JWT_SECRET!;
const ISSUER = process.env.JWT_ISSUER!;
const AUDIENCE = process.env.JWT_AUDIENCE!;
const TIMEEXP = process.env.JWT_TIMEEXP! as SignOptions["expiresIn"];

export const generateToken = (payload: object): string =>{
    return jwt.sign(payload, SECRET, { 
        expiresIn: TIMEEXP,
        issuer: ISSUER,
        audience: AUDIENCE
    })   
}

export const verifyToken = (token: string) => {
    return jwt.verify(token, SECRET)
}