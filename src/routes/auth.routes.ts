import { Router } from "express";
import { login, me, register } from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { loginRateLimit, registerRateLimit } from "../middlewares/rate-limit.middleware";

const authRoutes = Router();

authRoutes.post("/register", registerRateLimit, register);
authRoutes.post("/login", loginRateLimit, login);
authRoutes.get("/me", authMiddleware, me);

export default authRoutes;
