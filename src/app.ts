
import dotenv from "dotenv";
import express from "express";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import roleRoutes from "./routes/role.routes";
import permissionRoutes from "./routes/permission.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

dotenv.config();

// Deployed (Render): set FRONTEND_URL=https://agricultureops.netlify.app. Local dev falls back to Vite.
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const app = express();
const cors = require("cors");
app.use(express.json());

app.use(
  cors({
    origin: FRONTEND_URL,
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

app.use(errorMiddleware);

export default app;
