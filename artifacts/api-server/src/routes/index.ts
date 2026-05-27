import { Router } from "express";
import { healthRouter } from "./health.js";
import { ordersRouter } from "./orders.js";
import { servicesRouter } from "./services.js";
import { batchesRouter } from "./batches.js";
import { analyticsRouter } from "./analytics.js";
import { workersRouter } from "./workers.js";

export const router = Router();

router.use(healthRouter);
router.use("/orders", ordersRouter);
router.use("/services", servicesRouter);
router.use("/batches", batchesRouter);
router.use("/analytics", analyticsRouter);
router.use("/workers", workersRouter);
