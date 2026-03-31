
import express from "express";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();
const cors = require("cors");
app.use(express.json());

app.use(
  cors({
    origin: "https://agricultureops.netlify.app", // your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // only needed if using cookies
  })
);

/*app.get("/", (req, res) => {
  res.send("Hello World!!!");
});*/

app.use("/api/v1/auth",authRoutes);
app.use("/api/v1/user",authMiddleware,userRoutes);

app.use(errorMiddleware);

export default app;
