import { Router } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { adminAuthRouter } from "./auth.js";
import { adminOverviewRouter } from "./overview.js";
import { adminTenantsRouter } from "./tenants.js";
import { adminDevicesRouter } from "./devices.js";
import { adminStorageRouter } from "./storage.js";
import { adminBackupsRouter } from "./backups.js";

export const adminRouter = Router();

adminRouter.use("/auth", adminAuthRouter);

adminRouter.use("/overview", requireAdmin, adminOverviewRouter);
adminRouter.use("/tenants", requireAdmin, adminTenantsRouter);
adminRouter.use("/devices", requireAdmin, adminDevicesRouter);
adminRouter.use("/storage", requireAdmin, adminStorageRouter);
adminRouter.use("/backups", requireAdmin, adminBackupsRouter);
