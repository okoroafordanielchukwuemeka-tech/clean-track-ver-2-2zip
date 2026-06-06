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
import { branchesRouter } from "./branches.js";
import { operationsRouter } from "./operations.js";
import { telemetryRouter } from "./telemetry.js";
import { recoveryRouter } from "./recovery.js";
import { alertsRouter } from "./alerts.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";
import { adminRouter } from "./admin/index.js";
import { communicationRouter } from "./communication.js";
import { webhooksRouter } from "./webhooks.js";
import { subscriptionRouter } from "./subscription.js";
import { productionHealthRouter } from "./production-health.js";

export const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/webhooks", webhooksRouter);

// Worker + owner routes (workers can run daily operations)
router.use("/orders", requireAuth, ordersRouter);
router.use("/orders/:orderId/pickups", requireAuth, pickupsRouter);
router.use("/customers", requireAuth, customersRouter);
router.use("/services", requireAuth, servicesRouter);
router.use("/notifications", requireAuth, notificationsRouter);
router.use("/settings", requireAuth, settingsRouter);

// Owner-only routes (financials, management, configuration)
// Analytics: workers access their own branch data; owners see all (or filter by ?branchId)
router.use("/analytics", requireAuth, analyticsRouter);
router.use("/workers", requireOwner, workersRouter);
router.use("/batches", requireOwner, batchesRouter);
router.use("/expenditures", requireOwner, expendituresRouter);
router.use("/expense-categories", requireOwner, expenseCategoriesRouter);
router.use("/message-templates", requireOwner, messageTemplatesRouter);
router.use("/discount-approvals", requireAuth, discountApprovalsRouter);
// GET /receipts (list)          → requireOwner enforced inside the handler
// GET /receipts/:receiptNumber  → requireAuth (workers + owners, for print page)
router.use("/receipts", requireAuth, receiptsRouter);
router.use("/branches", requireAuth, branchesRouter);
router.use("/operations", requireOwner, operationsRouter);
router.use("/telemetry", requireAuth, telemetryRouter);
router.use("/recovery", requireOwner, recoveryRouter);
router.use("/health", productionHealthRouter);
router.use("/alerts", requireOwner, alertsRouter);
router.use("/communication", requireOwner, communicationRouter);
router.use("/subscription", subscriptionRouter);

// Platform admin routes (CleanTrack internal — not for laundry owners)
router.use("/admin", adminRouter);
