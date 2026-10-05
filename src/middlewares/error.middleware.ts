import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";

export const errorMiddleware = (
    err: Error,
    req: Request,
    resp: Response,
    next: NextFunction
) => {
    if(err instanceof AppError) {
        return resp.status(err.statusCode).json({
            status: "error",
            message: err.message
        });
    }

    // Malformed JSON from express.json()
    if ((err as { type?: string }).type === "entity.parse.failed") {
        return resp.status(400).json({ status: "error", message: "Malformed JSON body" });
    }

    console.error("Unexpected Error:", err);

    return resp.status(500).json({
        status: "Error",
        message: "Internal Server Error" 
    });

}