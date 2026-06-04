import express from "express";
import cors from "cors";
import { router } from "./routes/index.js";
import { versionMiddleware } from "./middleware/version.js";

const app = express();

app.use(cors({
  exposedHeaders: ["X-Server-Version", "X-Min-Client-Version", "X-Version-Warning"],
}));
app.use(express.json());
app.use(versionMiddleware);

app.use("/api", router);

export default app;
