---
name: Shared Operational Workspace (Phase 7.17.1)
description: Architecture decisions and fixes made to unify owner+worker operational workspace with branch isolation.
---

# Shared Operational Workspace — Phase 7.17.1

## Key Decisions

### auth.ts — Live branchId from DB
Extended the worker requireAuth DB lookup (which already fetched pinChangedAt) to also fetch `branchId` and override payload.branchId. Branch reassignment is now instant — next API call sees the new branch, no re-login required.

**Why:** JWT branchId is stamped at login time. Without this, moving a worker between branches requires logout/login.

### batches.ts — Full rewrite
Batches table has no branchId column. Branch isolation achieved by:
1. SELECT DISTINCT batchId FROM orders WHERE branchId=worker.branchId
2. Filter batches by that ID list (inArray)
Added checkPermission("view:orders") on GET, checkPermission("process:orders") on POST/PATCH.

**Why:** Batches was previously requireOwner. Workers need batch access for their branch only.

### conversations.ts — Branch isolation added
GET /conversations and GET /unread-count add eq(conversations.branchId, workerBranchId) when req.auth.branchId is set.

### routes/index.ts — batches changed from requireOwner to requireAuth
Permission checks moved inside the router using checkPermission().

### WORKER_DEFAULT_PERMISSIONS — Updated to operational defaults
Changed from all-false to: canViewCustomers, canCreateCustomers, canViewCustomerBalances, canRecordPayments, canRecordPickups, canViewOrders, canProcessOrders = true. WhatsApp perms remain false (opt-in).

**Why:** New workers had zero permissions by default — couldn't do anything without manual owner setup.

### protected-route.tsx — WORKER_ALLOWED_PREFIXES expanded
Added /receipts, /batches, /customer-hub.

### layout.tsx — Worker nav permission-aware
workerNavItems moved inside LayoutInner as computed value. Shows Receipts (canViewOrders), Batches (canViewOrders|canProcessOrders), Customer Hub (canViewWhatsApp). Unread count enabled for workers with canViewWhatsApp.
