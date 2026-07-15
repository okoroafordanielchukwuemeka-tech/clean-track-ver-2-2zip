import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { services, orderItems, orders, serviceBranches, branches } from "@workspace/db/schema";
import { eq, and, ne, sql, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";
import { getStorageDriver, MAX_UPLOAD_BYTES, ALLOWED_MIME_TYPES } from "../lib/storage.js";

export const servicesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_TYPE"));
    }
    cb(null, true);
  },
});

const CSV_MIME_TYPES = ["text/csv", "application/vnd.ms-excel", "application/csv", "text/plain"];
const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!CSV_MIME_TYPES.includes(file.mimetype) && !file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("UNSUPPORTED_TYPE"));
    }
    cb(null, true);
  },
});

const serviceInputSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  standardPrice: z.number().min(0),
  expressPrice: z.number().optional(),
  premiumPrice: z.number().optional(),
  isActive: z.boolean().default(true),
  imageUrl: z.string().nullable().optional(),
  branchIds: z.array(z.number().int()).nullable().optional(),
});

const serviceUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  standardPrice: z.number().min(0).optional(),
  expressPrice: z.number().optional(),
  premiumPrice: z.number().optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().nullable().optional(),
  branchIds: z.array(z.number().int()).nullable().optional(),
});

/** Check for duplicate name (case-insensitive) within this laundry, optionally excluding a specific id */
async function isDuplicateName(laundryId: number, name: string, excludeId?: number): Promise<boolean> {
  const all = await db.select({ id: services.id, name: services.name })
    .from(services)
    .where(eq(services.laundryId, laundryId));
  return all.some(s => {
    if (excludeId && s.id === excludeId) return false;
    return s.name.trim().toLowerCase() === name.trim().toLowerCase();
  });
}

/** Get the next displayOrder value for a new service */
async function getNextDisplayOrder(laundryId: number): Promise<number> {
  const all = await db.select({ displayOrder: services.displayOrder })
    .from(services)
    .where(eq(services.laundryId, laundryId));
  if (all.length === 0) return 1;
  return Math.max(...all.map(s => s.displayOrder ?? 0)) + 1;
}

/** Set of branchIds a service is available at; null/empty means "all branches" */
async function setServiceBranches(serviceId: number, branchIds: number[] | null | undefined) {
  if (branchIds === undefined) return; // not provided — leave untouched
  await db.delete(serviceBranches).where(eq(serviceBranches.serviceId, serviceId));
  if (branchIds && branchIds.length > 0) {
    await db.insert(serviceBranches).values(branchIds.map(branchId => ({ serviceId, branchId })));
  }
}

/** Load branchIds-per-service map for a laundry; a service missing from the map is available everywhere */
async function loadBranchAvailability(laundryId: number, serviceIds: number[]): Promise<Map<number, number[]>> {
  if (serviceIds.length === 0) return new Map();
  const rows = await db.select({ serviceId: serviceBranches.serviceId, branchId: serviceBranches.branchId })
    .from(serviceBranches)
    .innerJoin(services, eq(services.id, serviceBranches.serviceId))
    .where(and(eq(services.laundryId, laundryId), inArray(serviceBranches.serviceId, serviceIds)));
  const map = new Map<number, number[]>();
  for (const r of rows) {
    if (!map.has(r.serviceId)) map.set(r.serviceId, []);
    map.get(r.serviceId)!.push(r.branchId);
  }
  return map;
}

/** Compute usage stats (order count, revenue, last used) per service from order_items, scoped to a laundry via orders join */
async function loadUsageStats(laundryId: number): Promise<Map<number, { usageCount: number; revenue: number; lastUsedAt: string | null }>> {
  const rows = await db
    .select({
      serviceId: orderItems.serviceId,
      quantity: orderItems.quantity,
      totalPrice: orderItems.totalPrice,
      createdAt: orderItems.createdAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orders.laundryId, laundryId));

  const map = new Map<number, { usageCount: number; revenue: number; lastUsedAt: string | null }>();
  for (const r of rows) {
    if (r.serviceId == null) continue;
    const entry = map.get(r.serviceId) ?? { usageCount: 0, revenue: 0, lastUsedAt: null };
    entry.usageCount += r.quantity;
    entry.revenue += parseFloat(r.totalPrice);
    const ts = new Date(r.createdAt).toISOString();
    if (!entry.lastUsedAt || ts > entry.lastUsedAt) entry.lastUsedAt = ts;
    map.set(r.serviceId, entry);
  }
  return map;
}

function enrichServices(list: (typeof services.$inferSelect)[], branchMap: Map<number, number[]>, usageMap: Map<number, { usageCount: number; revenue: number; lastUsedAt: string | null }>) {
  return list.map(s => ({
    ...s,
    branchIds: branchMap.get(s.id) ?? null, // null = available at all branches
    usageCount: usageMap.get(s.id)?.usageCount ?? 0,
    revenue: usageMap.get(s.id)?.revenue ?? 0,
    lastUsedAt: usageMap.get(s.id)?.lastUsedAt ?? null,
  }));
}

// GET /services?filter=active|archived|all&category=..&search=..&sort=alpha|price|most_used|recent|category&branchId=..
servicesRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { category, activeOnly, filter, search, sort, branchId } = req.query as Record<string, string>;

    const all = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));

    const ids = all.map(s => s.id);
    const [branchMap, usageMap] = await Promise.all([
      loadBranchAvailability(laundryId, ids),
      loadUsageStats(laundryId),
    ]);

    // Workers are auto-scoped to their own branch; owners may pass ?branchId explicitly.
    const effectiveBranchId = req.auth!.branchId ?? (branchId ? parseInt(branchId) : null);

    let filtered = enrichServices(all, branchMap, usageMap).filter(s => {
      if (filter === "active") return s.isActive === true;
      if (filter === "archived") return s.isActive === false;
      if (filter === "all") return true;
      if (activeOnly === "false") return true;
      return s.isActive === true;
    }).filter(s => {
      if (category && s.category !== category) return false;
      return true;
    }).filter(s => {
      if (!search) return true;
      const q = search.trim().toLowerCase();
      return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
    }).filter(s => {
      if (!effectiveBranchId) return true;
      // null branchIds = available everywhere
      return s.branchIds === null || s.branchIds.includes(effectiveBranchId);
    });

    if (sort === "alpha") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "price") filtered = [...filtered].sort((a, b) => Number(a.standardPrice) - Number(b.standardPrice));
    else if (sort === "most_used") filtered = [...filtered].sort((a, b) => b.usageCount - a.usageCount);
    else if (sort === "recent") filtered = [...filtered].sort((a, b) => {
      if (!a.lastUsedAt && !b.lastUsedAt) return 0;
      if (!a.lastUsedAt) return 1;
      if (!b.lastUsedAt) return -1;
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    });
    else if (sort === "category") filtered = [...filtered].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list services" });
  }
});

// GET /services/categories — distinct categories in use, for filter chips
servicesRouter.get("/categories", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const all = await db.select({ category: services.category }).from(services).where(eq(services.laundryId, laundryId));
    const categories = [...new Set(all.map(s => s.category))].sort((a, b) => a.localeCompare(b));
    res.json(categories);
  } catch {
    res.status(500).json({ error: "Failed to list categories" });
  }
});

// GET /services/export — CSV export
servicesRouter.get("/export", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const all = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));

    const header = ["name", "category", "standardPrice", "expressPrice", "premiumPrice", "isActive"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const s of all) {
      lines.push([s.name, s.category, s.standardPrice, s.expressPrice ?? "", s.premiumPrice ?? "", s.isActive].map(escape).join(","));
    }
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="services-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export services" });
  }
});

function parseCsv(text: string): string[][] {
  // Minimal RFC4180 CSV parser — handles quoted fields, commas and newlines inside quotes.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(f => f.length > 0) || row.length > 1) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ""));
}

// POST /services/import — CSV import (multipart file field "file"); validates, dedupes by name, transactional
servicesRouter.post("/import", requireOwner, uploadCsv.single("file"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });

    const text = req.file.buffer.toString("utf-8");
    const rows = parseCsv(text);
    if (rows.length === 0) return res.status(400).json({ error: "CSV file is empty" });

    const header = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);
    const nameIdx = header.indexOf("name");
    const categoryIdx = header.indexOf("category");
    const stdIdx = header.indexOf("standardprice");
    const expIdx = header.indexOf("expressprice");
    const premIdx = header.indexOf("premiumprice");
    const activeIdx = header.indexOf("isactive");

    if (nameIdx === -1 || categoryIdx === -1 || stdIdx === -1) {
      return res.status(400).json({ error: "CSV must include at least name, category, standardPrice columns" });
    }

    const existing = await db.select({ name: services.name }).from(services).where(eq(services.laundryId, laundryId));
    const existingNames = new Set(existing.map(s => s.name.trim().toLowerCase()));
    const seenInFile = new Set<string>();

    const errors: { row: number; error: string }[] = [];
    const toInsert: (typeof services.$inferInsert)[] = [];
    let nextOrder = await getNextDisplayOrder(laundryId);

    dataRows.forEach((cols, idx) => {
      const rowNum = idx + 2; // account for header + 1-index
      const name = (cols[nameIdx] ?? "").trim();
      const category = (cols[categoryIdx] ?? "").trim();
      const standardPriceRaw = (cols[stdIdx] ?? "").trim();

      if (!name) { errors.push({ row: rowNum, error: "Missing service name" }); return; }
      if (!category) { errors.push({ row: rowNum, error: "Missing category" }); return; }
      const standardPrice = parseFloat(standardPriceRaw);
      if (isNaN(standardPrice) || standardPrice < 0) { errors.push({ row: rowNum, error: `Invalid standardPrice "${standardPriceRaw}"` }); return; }

      const lower = name.toLowerCase();
      if (existingNames.has(lower)) { errors.push({ row: rowNum, error: `Duplicate of existing service "${name}"` }); return; }
      if (seenInFile.has(lower)) { errors.push({ row: rowNum, error: `Duplicate "${name}" within the file` }); return; }
      seenInFile.add(lower);

      const expressPriceRaw = expIdx >= 0 ? (cols[expIdx] ?? "").trim() : "";
      const premiumPriceRaw = premIdx >= 0 ? (cols[premIdx] ?? "").trim() : "";
      const isActiveRaw = activeIdx >= 0 ? (cols[activeIdx] ?? "").trim().toLowerCase() : "true";

      toInsert.push({
        laundryId,
        name,
        category,
        standardPrice: standardPrice.toString(),
        expressPrice: expressPriceRaw ? parseFloat(expressPriceRaw).toString() : null,
        premiumPrice: premiumPriceRaw ? parseFloat(premiumPriceRaw).toString() : null,
        isActive: isActiveRaw !== "false" && isActiveRaw !== "0",
        displayOrder: nextOrder++,
      });
    });

    if (toInsert.length === 0) {
      return res.status(400).json({ error: "No valid rows to import", created: 0, skipped: dataRows.length, errors });
    }

    // Transactional insert — rollback entirely on failure so a partial import never corrupts the catalog.
    const created = await db.transaction(async (tx) => {
      return tx.insert(services).values(toInsert).returning();
    });

    trackActivationEvent(laundryId, "service_created");
    res.status(201).json({ created: created.length, skipped: errors.length, errors, services: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to import services — no rows were saved." });
  }
});

// ── Bulk operations ──────────────────────────────────────────────────────────

const bulkIdsSchema = z.object({ ids: z.array(z.number().int()).min(1) });

servicesRouter.post("/bulk/archive", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { ids } = bulkIdsSchema.parse(req.body);
    const updated = await db.update(services).set({ isActive: false, updatedAt: new Date() })
      .where(and(inArray(services.id, ids), eq(services.laundryId, laundryId)))
      .returning();
    res.json({ updated: updated.length });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to archive services" });
  }
});

servicesRouter.post("/bulk/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { ids } = bulkIdsSchema.parse(req.body);
    const updated = await db.update(services).set({ isActive: true, updatedAt: new Date() })
      .where(and(inArray(services.id, ids), eq(services.laundryId, laundryId)))
      .returning();
    res.json({ updated: updated.length });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to restore services" });
  }
});

// Bulk delete is soft-delete only (archive) — permanent delete stays single-item via DELETE /:id, which itself
// refuses when a service has order history.
servicesRouter.post("/bulk/delete", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { ids } = bulkIdsSchema.parse(req.body);
    const updated = await db.update(services).set({ isActive: false, updatedAt: new Date() })
      .where(and(inArray(services.id, ids), eq(services.laundryId, laundryId)))
      .returning();
    res.json({ updated: updated.length, note: "Services archived (soft delete) to preserve order history." });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to delete services" });
  }
});

servicesRouter.post("/bulk/category", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { ids, category } = z.object({ ids: z.array(z.number().int()).min(1), category: z.string().min(1) }).parse(req.body);
    const updated = await db.update(services).set({ category, updatedAt: new Date() })
      .where(and(inArray(services.id, ids), eq(services.laundryId, laundryId)))
      .returning();
    res.json({ updated: updated.length });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update category" });
  }
});

const bulkPriceSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  priceField: z.enum(["standardPrice", "expressPrice", "premiumPrice"]),
  mode: z.enum(["set", "increase_percent", "decrease_percent", "increase_amount", "decrease_amount"]),
  value: z.number(),
});

servicesRouter.post("/bulk/price", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { ids, priceField, mode, value } = bulkPriceSchema.parse(req.body);

    const rows = await db.select().from(services).where(and(inArray(services.id, ids), eq(services.laundryId, laundryId)));
    let updatedCount = 0;
    for (const s of rows) {
      const current = parseFloat((s as any)[priceField] ?? "0");
      let next: number;
      if (mode === "set") next = value;
      else if (mode === "increase_percent") next = current * (1 + value / 100);
      else if (mode === "decrease_percent") next = current * (1 - value / 100);
      else if (mode === "increase_amount") next = current + value;
      else next = current - value;
      next = Math.max(0, Math.round(next * 100) / 100);

      await db.update(services).set({ [priceField]: next.toString(), updatedAt: new Date() } as any)
        .where(eq(services.id, s.id));
      updatedCount++;
    }
    res.json({ updated: updatedCount });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to bulk update prices" });
  }
});

servicesRouter.post("/:id/duplicate", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [source] = await db.select().from(services).where(and(eq(services.id, id), eq(services.laundryId, laundryId)));
    if (!source) return res.status(404).json({ error: "Service not found" });

    let name = `${source.name} (Copy)`;
    let n = 2;
    while (await isDuplicateName(laundryId, name)) {
      name = `${source.name} (Copy ${n})`;
      n++;
    }

    const displayOrder = await getNextDisplayOrder(laundryId);
    const [copy] = await db.insert(services).values({
      laundryId,
      name,
      category: source.category,
      standardPrice: source.standardPrice,
      expressPrice: source.expressPrice,
      premiumPrice: source.premiumPrice,
      isActive: source.isActive,
      displayOrder,
      imageUrl: source.imageUrl,
      thumbnailUrl: source.thumbnailUrl,
    }).returning();

    const sourceBranches = await db.select({ branchId: serviceBranches.branchId }).from(serviceBranches).where(eq(serviceBranches.serviceId, id));
    if (sourceBranches.length > 0) {
      await db.insert(serviceBranches).values(sourceBranches.map(b => ({ serviceId: copy.id, branchId: b.branchId })));
    }

    res.status(201).json(copy);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to duplicate service" });
  }
});

servicesRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [service] = await db.select().from(services)
      .where(and(eq(services.id, parseInt(req.params.id)), eq(services.laundryId, laundryId)));
    if (!service) return res.status(404).json({ error: "Service not found" });
    const branchMap = await loadBranchAvailability(laundryId, [service.id]);
    res.json({ ...service, branchIds: branchMap.get(service.id) ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to get service" });
  }
});

servicesRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = serviceInputSchema.parse(req.body);

    if (await isDuplicateName(laundryId, data.name)) {
      return res.status(409).json({ error: `A service named "${data.name}" already exists. Please choose a different name.` });
    }

    const displayOrder = await getNextDisplayOrder(laundryId);
    const [service] = await db.insert(services).values({
      name: data.name,
      category: data.category,
      isActive: data.isActive,
      laundryId,
      displayOrder,
      standardPrice: data.standardPrice.toString(),
      expressPrice: data.expressPrice?.toString(),
      premiumPrice: data.premiumPrice?.toString(),
      imageUrl: data.imageUrl ?? null,
    }).returning();

    if (data.branchIds !== undefined) await setServiceBranches(service.id, data.branchIds);

    trackActivationEvent(laundryId, "service_created");
    res.status(201).json({ ...service, branchIds: data.branchIds ?? null });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create service" });
  }
});

servicesRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const data = serviceUpdateSchema.parse(req.body);

    if (data.name) {
      if (await isDuplicateName(laundryId, data.name, id)) {
        return res.status(409).json({ error: `A service named "${data.name}" already exists. Please choose a different name.` });
      }
    }

    const { branchIds, ...rest } = data;
    const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (data.standardPrice !== undefined) updateData.standardPrice = data.standardPrice.toString();
    if (data.expressPrice !== undefined) updateData.expressPrice = data.expressPrice.toString();
    if (data.premiumPrice !== undefined) updateData.premiumPrice = data.premiumPrice.toString();

    const [service] = await db.update(services).set(updateData)
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });

    if (branchIds !== undefined) await setServiceBranches(id, branchIds);
    const branchMap = await loadBranchAvailability(laundryId, [id]);

    res.json({ ...service, branchIds: branchMap.get(id) ?? null });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update service" });
  }
});

// POST /services/:id/image — upload a custom photo (multipart field "file"); resizes, compresses, generates thumbnail
servicesRouter.post("/:id/image", requireOwner, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(services).where(and(eq(services.id, id), eq(services.laundryId, laundryId)));
    if (!existing) return res.status(404).json({ error: "Service not found" });
    if (!req.file) return res.status(400).json({ error: "No image file uploaded" });

    const driver = getStorageDriver();

    // Replacing an image: clean up the old file first (no-ops for "icon:" or null).
    if (existing.imageUrl) await driver.delete(existing.imageUrl);

    let uploaded;
    try {
      uploaded = await driver.upload(req.file.buffer, `service-${id}`, req.file.mimetype);
    } catch {
      return res.status(400).json({ error: "Could not process this image. Try a different JPG, PNG, or WEBP file." });
    }

    const [updated] = await db.update(services)
      .set({ imageUrl: uploaded.url, thumbnailUrl: uploaded.thumbnailUrl, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    if (err?.message === "UNSUPPORTED_TYPE") {
      return res.status(400).json({ error: "Unsupported file type. Upload a JPG, PNG, or WEBP image." });
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image is too large. Maximum size is 5MB." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// DELETE /services/:id/image — remove a custom photo; falls back to the auto-suggested default icon client-side
servicesRouter.delete("/:id/image", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(services).where(and(eq(services.id, id), eq(services.laundryId, laundryId)));
    if (!existing) return res.status(404).json({ error: "Service not found" });

    if (existing.imageUrl) await getStorageDriver().delete(existing.imageUrl);

    const [updated] = await db.update(services)
      .set({ imageUrl: null, thumbnailUrl: null, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove image" });
  }
});

// POST /services/:id/archive — soft-delete: mark isActive = false
servicesRouter.post("/:id/archive", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [service] = await db.update(services)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to archive service" });
  }
});

// POST /services/:id/restore — restore archived service
servicesRouter.post("/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [service] = await db.update(services)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to restore service" });
  }
});

// POST /services/reorder — move a service up or down
servicesRouter.post("/reorder", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { id, direction } = z.object({
      id: z.number().int(),
      direction: z.enum(["up", "down"]),
    }).parse(req.body);

    const all = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));

    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: "Service not found" });

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) {
      return res.json(all); // already at boundary, no-op
    }

    const current = all[idx];
    const swap = all[swapIdx];

    // Swap displayOrder values
    await db.update(services).set({ displayOrder: swap.displayOrder, updatedAt: new Date() })
      .where(eq(services.id, current.id));
    await db.update(services).set({ displayOrder: current.displayOrder, updatedAt: new Date() })
      .where(eq(services.id, swap.id));

    const updated = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to reorder services" });
  }
});

servicesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);

    // Verify service exists and belongs to this laundry
    const [existing] = await db.select().from(services)
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)));
    if (!existing) return res.status(404).json({ error: "Service not found" });

    // Check if used by any historical orders
    const usages = await db.select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.serviceId, id))
      .limit(1);

    if (usages.length > 0) {
      return res.status(409).json({
        error: "This service cannot be deleted because it has been used in past orders. Archive it instead to hide it from new orders while keeping your historical records intact.",
        code: "SERVICE_IN_USE",
      });
    }

    if (existing.imageUrl) await getStorageDriver().delete(existing.imageUrl);
    await db.delete(serviceBranches).where(eq(serviceBranches.serviceId, id));
    await db.delete(services).where(eq(services.id, id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete service" });
  }
});
