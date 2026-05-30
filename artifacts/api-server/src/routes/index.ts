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
import { settingsRouter } from "./settings.js";
import { messageTemplatesRouter } from "./message-templates.js";
import { expenseCategoriesRouter } from "./expense-categories.js";
import { discountApprovalsRouter } from "./discount-approvals.js";
import { receiptsRouter } from "./receipts.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";

export const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);

// Worker + owner routes (workers can run daily operations)
router.use("/orders", requireAuth, ordersRouter);
router.use("/orders/:orderId/pickups", requireAuth, pickupsRouter);
router.use("/customers", requireAuth, customersRouter);
router.use("/services", requireAuth, servicesRouter);
router.use("/notifications", requireAuth, notificationsRouter);
router.use("/settings", requireAuth, settingsRouter);

// Owner-only routes (financials, management, configuration)
router.use("/analytics", requireOwner, analyticsRouter);
router.use("/workers", requireOwner, workersRouter);
router.use("/batches", requireOwner, batchesRouter);
router.use("/expenditures", requireOwner, expendituresRouter);
router.use("/expense-categories", requireOwner, expenseCategoriesRouter);
router.use("/message-templates", requireOwner, messageTemplatesRouter);
router.use("/discount-approvals", requireAuth, discountApprovalsRouter);
// Receipt detail (by number) is requireAuth — workers need it to print receipts from order detail.
// Receipt list (GET /) enforces requireOwner internally.
router.use("/receipts", requireAuth, receiptsRouter);
