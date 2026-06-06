import express from "express";
import cors from "cors";
import { router } from "./routes/index.js";
import { versionMiddleware } from "./middleware/version.js";

const app = express();

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

app.use(cors({
  exposedHeaders: ["X-Server-Version", "X-Min-Client-Version", "X-Version-Warning"],
  origin: allowedOrigins
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      }
    : true,
}));
app.use(express.json());
app.use(versionMiddleware);

app.use("/api", router);

export default app;
