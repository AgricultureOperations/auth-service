
import dotenv from "dotenv";
import express from "express";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import roleRoutes from "./routes/role.routes";
import permissionRoutes from "./routes/permission.routes";
import customerRoutes from "./routes/customer.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

dotenv.config();

// Allowed browser origins, comma-separated: the internal dashboard and the customer portal (frontend).
// Render: FRONTEND_URL=https://agricultureops.netlify.app,<portal URL>. Local dev falls back to both Vite and Next.
export const allowedOrigins = (value = process.env.FRONTEND_URL) =>
  (value || "http://localhost:5173,http://localhost:3100")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const app = express();
const cors = require("cors");
app.use(express.json());
// Render terminates TLS in front of the app; the rate limiter needs the client IP from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: allowedOrigins(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true, // only needed if using cookies
  })
);

/*app.get("/", (req, res) => {
  res.send("Hello World!!!");
});*/

app.use("/api/v1/auth",authRoutes);
app.use("/api/v1/user",authMiddleware,userRoutes);
app.use("/api/v1/roles",authMiddleware,roleRoutes);
app.use("/api/v1/permissions",authMiddleware,permissionRoutes);
app.use("/api/v1/customers",authMiddleware,customerRoutes);

app.use(errorMiddleware);

export default app;
