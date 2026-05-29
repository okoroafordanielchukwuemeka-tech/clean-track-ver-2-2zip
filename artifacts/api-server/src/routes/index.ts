import { Router } from "express";
import { healthRouter } from "./health.js";
import { ordersRouter } from "./orders.js";
import { servicesRouter } from "./services.js";
import { batchesRouter } from "./batches.js";
import { analyticsRouter } from "./analytics.js";
import { workersRouter } from "./workers.js";
import { authRouter } from "./auth.js";
import { pickupsRouter } from "./pickups.js";
import { customersRouter } from "./customers.js";
import { notificationsRouter } from "./notifications.js";
import { expendituresRouter } from "./expenditures.js";
import { requireAuth } from "../middleware/auth.js";

export const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/orders", requireAuth, ordersRouter);
router.use("/orders/:orderId/pickups", requireAuth, pickupsRouter);
router.use("/customers", requireAuth, customersRouter);
router.use("/services", requireAuth, servicesRouter);
router.use("/batches", requireAuth, batchesRouter);
router.use("/analytics", requireAuth, analyticsRouter);
router.use("/workers", requireAuth, workersRouter);
router.use("/notifications", requireAuth, notificationsRouter);
router.use("/expenditures", requireAuth, expendituresRouter);
