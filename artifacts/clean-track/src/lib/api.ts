import { APP_VERSION } from "./version";

const BASE_URL = "/api";
const TOKEN_KEY = "ct_token";

// ── Outdated-client detection ───────────────────────────────────────────────
// The server sends X-Min-Client-Version on every response.  If the running
// APP_VERSION is older than that value, we flip _clientOutdated and notify
// all subscribers (e.g. OutdatedClientBanner) so they can prompt a reload.

let _clientOutdated = false;
const _outdatedListeners: Array<() => void> = [];

export function isClientOutdated(): boolean {
  return _clientOutdated;
}

export function subscribeOutdated(cb: () => void): () => void {
  _outdatedListeners.push(cb);
  return () => {
    const i = _outdatedListeners.indexOf(cb);
    if (i >= 0) _outdatedListeners.splice(i, 1);
  };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function checkVersionHeaders(res: Response): void {
  try {
    const minVersion = res.headers.get("X-Min-Client-Version");
    if (minVersion && !_clientOutdated) {
      if (compareVersions(APP_VERSION, minVersion) < 0) {
        _clientOutdated = true;
        _outdatedListeners.forEach((cb) => {
          try { cb(); } catch { /* listeners must not crash the engine */ }
        });
      }
    }
  } catch { /* never let version checking crash a real request */ }
}

/**
 * Thrown by the API client for any non-2xx response.
 * Carries the raw HTTP status code so the sync engine can distinguish
 * 4xx validation failures (permanent, no retry) from 5xx / network
 * errors (transient, should retry with backoff).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  headers["X-Client-Version"] = APP_VERSION;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  checkVersionHeaders(res);

  if (res.status === 401) {
    const err = await res.json().catch(() => ({ error: "Unauthorized" }));
    if (path.startsWith("/auth/")) {
      throw new HttpError(401, err.error || "Invalid credentials");
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("ct_user");
    window.location.href = "/login";
    throw new HttpError(401, "Session expired. Please log in again.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new HttpError(res.status, err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    signup: (data: SignupInput) => request<AuthResponse>("POST", "/auth/signup", data),
    ownerLogin: (data: OwnerLoginInput) => request<AuthResponse>("POST", "/auth/owner-login", data),
    demoLogin: () => request<AuthResponse>("POST", "/auth/demo-login"),
    workerLogin: (data: WorkerLoginInput) => request<WorkerAuthResponse>("POST", "/auth/worker-login", data),
    me: () => request<AuthUser>("GET", "/auth/me"),
    forgotPassword: (email: string) =>
      request<{ message: string }>("POST", "/auth/forgot-password", { email }),
    resetPassword: (token: string, newPassword: string) =>
      request<{ message: string }>("POST", "/auth/reset-password", { token, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ message: string; token: string }>("POST", "/auth/change-password", {
        currentPassword,
        newPassword,
      }),
    welcomeViewed: () =>
      request<{ ok: boolean }>("POST", "/auth/welcome-viewed"),
  },
  branches: {
    list: () => request<import("@/context/branch-context").Branch[]>("GET", "/branches"),
    create: (data: { name: string; address?: string }) =>
      request<import("@/context/branch-context").Branch>("POST", "/branches", data),
    update: (id: number, data: { name?: string; address?: string }) =>
      request<import("@/context/branch-context").Branch>("PATCH", `/branches/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/branches/${id}`),
  },
  orders: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<Order[]>("GET", `/orders${qs}`);
    },
    get: (id: number) => request<Order>("GET", `/orders/${id}`),
    create: (data: OrderInput, idempotencyKey?: string) => request<Order>("POST", "/orders", data, idempotencyKey),
    update: (id: number, data: Partial<OrderUpdate>, idempotencyKey?: string) => request<Order>("PATCH", `/orders/${id}`, data, idempotencyKey),
    delete: (id: number) => request<void>("DELETE", `/orders/${id}`),
    summary: () => request<OrdersSummary>("GET", "/orders/summary"),
    recent: (branchId?: number | null) => {
      const qs = branchId ? `?branchId=${branchId}` : "";
      return request<Order[]>("GET", `/orders/recent${qs}`);
    },
    payments: (id: number) => request<PaymentRecord[]>("GET", `/orders/${id}/payments`),
    recordPayment: (id: number, data: PaymentInput, idempotencyKey?: string) => request<PaymentRecord>("POST", `/orders/${id}/payments`, data, idempotencyKey),
    deletePayment: (id: number, paymentId: number) => request<void>("DELETE", `/orders/${id}/payments/${paymentId}`),
    items: (id: number) => request<OrderItem[]>("GET", `/orders/${id}/items`),
    addItems: (id: number, data: { items: OrderItemInput[] }) => request<Order>("POST", `/orders/${id}/items`, data),
    priceAdjustments: (id: number) => request<PriceAdjustment[]>("GET", `/orders/${id}/price-adjustments`),
    addPriceAdjustment: (id: number, data: PriceAdjustmentInput) => request<PriceAdjustment>("POST", `/orders/${id}/price-adjustments`, data),
    auditLog: (id: number) => request<AuditLogEntry[]>("GET", `/orders/${id}/audit-log`),
    sendNotification: (id: number, type: "ready" | "reminder") =>
      request<{ queued: boolean; message: string }>("POST", `/orders/${id}/send-notification`, { type }),
    getMessages: (id: number) =>
      request<{ messages: OrderMessage[]; total: number }>("GET", `/orders/${id}/messages`),
    retryMessage: (id: number, msgId: number) =>
      request<{ success: boolean; status: string; error?: string }>("POST", `/orders/${id}/messages/${msgId}/retry`),
  },
  discountApprovals: {
    list: (status?: "pending" | "approved" | "rejected") => {
      const qs = status ? `?status=${status}` : "";
      return request<DiscountApproval[]>("GET", `/discount-approvals${qs}`);
    },
    pendingCount: () => request<{ count: number }>("GET", "/discount-approvals/pending-count"),
    resolve: (id: number, status: "approved" | "rejected") =>
      request<DiscountApproval>("PATCH", `/discount-approvals/${id}`, { status }),
  },
  services: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<Service[]>("GET", `/services${qs}`);
    },
    get: (id: number) => request<Service>("GET", `/services/${id}`),
    create: (data: ServiceInput) => request<Service>("POST", "/services", data),
    update: (id: number, data: Partial<ServiceInput>) => request<Service>("PATCH", `/services/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/services/${id}`),
  },
  batches: {
    list: () => request<Batch[]>("GET", "/batches"),
    get: (id: number) => request<BatchWithOrders>("GET", `/batches/${id}`),
    create: (data: BatchInput) => request<Batch>("POST", "/batches", data),
    update: (id: number, data: { status: "active" | "completed" }) => request<Batch>("PATCH", `/batches/${id}`, data),
  },
  analytics: {
    overview: () => request<AnalyticsOverview>("GET", "/analytics/overview"),
    daily: () => request<DailyStats[]>("GET", "/analytics/daily"),
    full: (period: AnalyticsPeriod, branchId?: number | null) => {
      const qs = new URLSearchParams({ period } as any);
      if (branchId) qs.set("branchId", String(branchId));
      return request<FullAnalytics>("GET", `/analytics/full?${qs}`);
    },
    customerAnalytics: (branchId?: number | null) => {
      const qs = branchId ? `?branchId=${branchId}` : "";
      return request<CustomerAnalytics>("GET", `/analytics/customers${qs}`);
    },
    workerAnalytics: (branchId?: number | null) => {
      const qs = branchId ? `?branchId=${branchId}` : "";
      return request<WorkerAnalytics>("GET", `/analytics/workers${qs}`);
    },
  },
  workers: {
    list: () => request<Worker[]>("GET", "/workers"),
    get: (id: number) => request<Worker>("GET", `/workers/${id}`),
    create: (data: WorkerInput) => request<Worker>("POST", "/workers", data),
    update: (id: number, data: Partial<WorkerInput>) => request<Worker>("PATCH", `/workers/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/workers/${id}`),
  },
  pickups: {
    list: (orderId: number) => request<PickupRecord[]>("GET", `/orders/${orderId}/pickups`),
    record: (orderId: number, data: PickupInput, idempotencyKey?: string) => request<PickupResponse>("POST", `/orders/${orderId}/pickups`, data, idempotencyKey),
  },
  customers: {
    list: (params?: { search?: string; tag?: string; branchId?: number | null }) => {
      const cleaned = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : {};
      const qs = Object.keys(cleaned).length ? "?" + new URLSearchParams(cleaned).toString() : "";
      return request<CustomerWithMetrics[]>("GET", `/customers${qs}`);
    },
    get: (id: number) => request<CustomerProfile>("GET", `/customers/${id}`),
    create: (data: CustomerInput, idempotencyKey?: string) => request<CustomerWithMetrics>("POST", "/customers", data, idempotencyKey),
    update: (id: number, data: CustomerUpdateInput) => request<Customer>("PATCH", `/customers/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/customers/${id}`),
    backfill: () => request<{ created: number; linked: number; message: string }>("POST", "/customers/backfill"),
    statement: (id: number, params?: { from?: string; to?: string }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null) as any)).toString() : "";
      return request<CustomerStatement>("GET", `/customers/${id}/statement${qs}`);
    },
  },
  notifications: {
    list: (unread?: boolean) => {
      const qs = unread ? "?unread=true" : "";
      return request<Notification[]>("GET", `/notifications${qs}`);
    },
    count: () => request<{ count: number }>("GET", "/notifications/count"),
    markRead: (id: number) => request<{ success: boolean }>("PATCH", `/notifications/${id}/read`),
    markAllRead: () => request<{ success: boolean }>("PATCH", "/notifications/read-all"),
    delete: (id: number) => request<void>("DELETE", `/notifications/${id}`),
  },
  settings: {
    getSla: () => request<SlaSettings>("GET", "/settings/sla"),
    updateSla: (data: Partial<SlaSettings>) => request<SlaSettings>("PATCH", "/settings/sla", data),
    getSlaAnalytics: () => request<SlaAnalytics & { slaSettings: SlaSettings }>("GET", "/analytics/sla"),
    getBusinessProfile: () => request<BusinessProfile>("GET", "/settings/business-profile"),
    updateBusinessProfile: (data: Partial<BusinessProfile>) => request<BusinessProfile>("PATCH", "/settings/business-profile", data),
    getBranding: () => request<BrandingSettings>("GET", "/settings/branding"),
    updateBranding: (data: Partial<BrandingSettings>) => request<BrandingSettings>("PATCH", "/settings/branding", data),
    getOperational: () => request<OperationalSettings>("GET", "/settings/operational"),
    updateOperational: (data: Partial<OperationalSettings>) => request<OperationalSettings>("PATCH", "/settings/operational", data),
    getAutomation: () => request<AutomationSettings>("GET", "/settings/automation"),
    updateAutomation: (data: Partial<AutomationSettings>) => request<AutomationSettings>("PATCH", "/settings/automation", data),
    getDashboardPreferences: () => request<DashboardPreferences>("GET", "/settings/dashboard-preferences"),
    updateDashboardPreferences: (data: Partial<DashboardPreferences>) => request<DashboardPreferences>("PATCH", "/settings/dashboard-preferences", data),
    getDiscountSettings: () => request<DiscountSettings>("GET", "/settings/discount-settings"),
    updateDiscountSettings: (data: Partial<DiscountSettings>) => request<DiscountSettings>("PATCH", "/settings/discount-settings", data),
  },
  workerPermissions: {
    get: (workerId: number) => request<WorkerPermission>("GET", `/workers/${workerId}/permissions`),
    update: (workerId: number, data: Partial<WorkerPermission>) => request<WorkerPermission>("PUT", `/workers/${workerId}/permissions`, data),
  },
  messageTemplates: {
    list: () => request<MessageTemplate[]>("GET", "/message-templates"),
    create: (data: MessageTemplateInput) => request<MessageTemplate>("POST", "/message-templates", data),
    update: (id: number, data: Partial<MessageTemplateInput>) => request<MessageTemplate>("PATCH", `/message-templates/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/message-templates/${id}`),
  },
  communication: {
    stats: () => request<NotifStats>("GET", "/communication/stats"),
    seedDefaults: () => request<{ seeded: number; message?: string }>("POST", "/communication/templates/seed-defaults"),
    listTemplates: (params?: { trigger?: string; channel?: string; branchId?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))).toString() : "";
      return request<NotifTemplate[]>("GET", `/communication/templates${qs}`);
    },
    getTemplate: (id: number) => request<NotifTemplate>("GET", `/communication/templates/${id}`),
    createTemplate: (data: NotifTemplateInput) => request<NotifTemplate>("POST", "/communication/templates", data),
    updateTemplate: (id: number, data: Partial<NotifTemplateInput>) => request<NotifTemplate>("PATCH", `/communication/templates/${id}`, data),
    deleteTemplate: (id: number) => request<void>("DELETE", `/communication/templates/${id}`),
    getWhatsAppConfig: () => request<WaProviderConfig>("GET", "/communication/providers/whatsapp"),
    saveWhatsAppConfig: (data: WaConfigInput) =>
      request<{ saved: boolean }>("PUT", "/communication/providers/whatsapp", data),
    validateWhatsAppConfig: () =>
      request<WaValidateResult>("POST", "/communication/providers/whatsapp/validate"),
    deleteWhatsAppConfig: () => request<void>("DELETE", "/communication/providers/whatsapp"),
    sendTestMessage: (data: { phone: string; body: string }) =>
      request<TestMessageResult>("POST", "/communication/test-message", data),
    retryMessage: (id: number) =>
      request<{ success: boolean; error?: string }>("POST", `/communication/messages/${id}/retry`),
    listMessages: (params?: { status?: string; channel?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))).toString() : "";
      return request<{ messages: NotifMessage[]; total: number }>("GET", `/communication/messages${qs}`);
    },
    listEvents: (params?: { status?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))).toString() : "";
      return request<{ events: NotifEvent[]; total: number }>("GET", `/communication/events${qs}`);
    },
  },
  whatsapp: {
    status: () => request<WaConnectionStatus>("GET", "/whatsapp/status"),
    metaConfig: () => request<WaMetaConfig>("GET", "/whatsapp/meta/config"),
    metaStart: () => request<{ started: boolean }>("POST", "/whatsapp/meta/start"),
    metaCallback: (data: WaMetaCallbackInput) =>
      request<{ connected: true; displayPhoneNumber: string | null; businessName: string | null; connectedAt: string }>(
        "POST", "/whatsapp/meta/callback", data
      ),
    connect: (data: WaConnectInput) => request<{ connected: true; displayPhoneNumber: string | null; businessName: string | null; connectedAt: string }>("POST", "/whatsapp/connect", data),
    disconnect: () => request<{ connected: false; disconnectedAt: string }>("POST", "/whatsapp/disconnect"),
  },
  operations: {
    auditLog: (params?: { period?: string; action?: string; actorType?: string; actorName?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) as any).toString() : "";
      return request<OpsAuditLogResponse>("GET", `/operations/audit-log${qs}`);
    },
    payments: (params?: { period?: string; method?: string; branchId?: number; recordedBy?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) as any).toString() : "";
      return request<OpsPaymentsResponse>("GET", `/operations/payments${qs}`);
    },
    pickups: (params?: { period?: string; recordedBy?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) as any).toString() : "";
      return request<OpsPickupsResponse>("GET", `/operations/pickups${qs}`);
    },
    workerActivity: (params?: { period?: string; actorName?: string; action?: string; limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) as any).toString() : "";
      return request<OpsWorkerActivityResponse>("GET", `/operations/worker-activity${qs}`);
    },
    health: () => request<OpsHealthResponse>("GET", "/operations/health"),
    syncHealth: () => request<OpsSyncHealthResponse>("GET", "/operations/sync-health"),
    failedMessages: (params?: { limit?: number; offset?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) as any).toString() : "";
      return request<OpsFailedMessagesResponse>("GET", `/operations/failed-messages${qs}`);
    },
    requeueMessage: (id: number) => request<{ id: number; status: string; message: string }>("POST", `/operations/failed-messages/${id}/requeue`),
  },
  telemetry: {
    heartbeat: (data: HeartbeatInput) => request<void>("POST", "/telemetry/heartbeat", data),
  },
  recovery: {
    summary: () => request<RecoverySummary>("GET", "/recovery/summary"),
    workers: () => request<DeletedWorker[]>("GET", "/recovery/workers"),
    customers: () => request<DeletedCustomer[]>("GET", "/recovery/customers"),
    branches: () => request<DeletedBranch[]>("GET", "/recovery/branches"),
    payments: () => request<DeletedPayment[]>("GET", "/recovery/payments"),
    restoreWorker: (id: number) => request<{ id: number; name: string; restored: boolean }>("POST", `/recovery/workers/${id}/restore`),
    restoreCustomer: (id: number) => request<{ id: number; fullName: string; restored: boolean }>("POST", `/recovery/customers/${id}/restore`),
    restoreBranch: (id: number) => request<{ id: number; name: string; restored: boolean }>("POST", `/recovery/branches/${id}/restore`),
    restorePayment: (id: number) => request<{ id: number; receiptNumber: string; amount: string; restored: boolean }>("POST", `/recovery/payments/${id}/restore`),
    readiness: () => request<DRReadiness>("GET", "/recovery/readiness"),
    backups: () => request<BackupFile[]>("GET", "/recovery/backups"),
    triggerBackup: () => request<BackupTriggerResult>("POST", "/recovery/trigger-backup"),
    verifyLatest: () => request<BackupVerifyResult>("POST", "/recovery/verify-latest"),
    migrations: () => request<SchemaSnapshot[]>("GET", "/recovery/migrations"),
    recordSnapshot: (notes?: string) => request<SchemaSnapshot>("POST", "/recovery/record-snapshot", { notes }),
  },
  expenseCategories: {
    list: () => request<ExpenseCategoryRecord[]>("GET", "/expense-categories"),
    create: (data: { name: string }) => request<ExpenseCategoryRecord>("POST", "/expense-categories", data),
    update: (id: number, data: { name?: string; isActive?: boolean }) => request<ExpenseCategoryRecord>("PATCH", `/expense-categories/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/expense-categories/${id}`),
  },
  expenditures: {
    list: (period?: string) => {
      const qs = period ? `?period=${period}` : "";
      return request<Expenditure[]>("GET", `/expenditures${qs}`);
    },
    summary: (period?: string) => {
      const qs = period ? `?period=${period}` : "";
      return request<ExpenditureSummary>("GET", `/expenditures/summary${qs}`);
    },
    create: (data: ExpenditureInput) => request<Expenditure>("POST", "/expenditures", data),
    update: (id: number, data: Partial<ExpenditureInput>) => request<Expenditure>("PATCH", `/expenditures/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/expenditures/${id}`),
  },
  receipts: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<ReceiptListResponse>("GET", `/receipts${qs}`);
    },
    getByNumber: (receiptNumber: string) => request<import("@/components/receipt-view").ReceiptData>("GET", `/receipts/${encodeURIComponent(receiptNumber)}`),
    getForOrder: (orderId: number) => request<import("@/components/receipt-view").ReceiptData>("GET", `/orders/${orderId}/receipt`),
    getCustomerReceipts: (customerId: number) => request<ReceiptListResponse>("GET", `/customers/${customerId}/receipts`),
  },
  alerts: {
    list: (params?: {
      status?: string;
      severity?: string;
      category?: string;
      branchId?: number;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }) => {
      const qs = params
        ? "?" +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries(params)
                .filter(([, v]) => v != null)
                .map(([k, v]) => [k, String(v)])
            )
          ).toString()
        : "";
      return request<AlertsListResponse>("GET", `/alerts${qs}`);
    },
    counts: () => request<AlertCounts>("GET", "/alerts/counts"),
    acknowledge: (id: number) => request<AlertRecord>("POST", `/alerts/${id}/acknowledge`),
    resolve: (id: number) => request<AlertRecord>("POST", `/alerts/${id}/resolve`),
    runCheck: () =>
      request<{ success: boolean; created: number }>("POST", "/alerts/run-check"),
  },
  subscription: {
    getStatus: () => request<SubscriptionStatus>("GET", "/subscription/status"),
    getUsage: () => request<SubscriptionUsage>("GET", "/subscription/usage"),
    getPricing: () => request<SubscriptionPricing>("GET", "/subscription/pricing"),
    logUpgradeIntent: (targetPlan: string, source?: string) =>
      request<{ logged: boolean; message: string }>("POST", "/subscription/upgrade-intent", {
        targetPlan,
        source: source ?? "billing_settings",
      }),
  },
  health: {
    production: () => request<unknown>("GET", "/health/production"),
  },
};

export interface AuthUser {
  type: "owner" | "worker";
  id: number;
  name: string;
  email?: string;
  phone?: string | null;
  role?: "admin" | "worker";
  laundryId?: number;
}

export interface SignupInput {
  businessName: string;
  ownerEmail: string;
  password: string;
  phone?: string;
}

export interface OwnerLoginInput {
  email: string;
  password: string;
}

export interface WorkerLoginInput {
  phone: string;
  pin: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  laundry: {
    id: number;
    businessName: string;
    ownerEmail: string;
    phone?: string | null;
    subscriptionTier: string;
    createdAt: string;
  };
}

export interface WorkerAuthResponse {
  token: string;
  user: AuthUser;
  worker: Worker;
}

export interface Order {
  id: number;
  laundryId?: number | null;
  orderId: string;
  customerName: string;
  phone: string;
  address?: string | null;
  serviceType: "standard" | "express" | "premium";
  shirts: number;
  trousers: number;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  additionalNotes?: string | null;
  status: "pending" | "processing" | "ready" | "partial_pickup" | "completed";
  paymentStatus: "unpaid" | "partial" | "paid";
  price?: number | null;
  extraCharge?: number | null;
  discount?: number | null;
  amountPaid: number;
  verifiedShirts?: number | null;
  verifiedTrousers?: number | null;
  isVerified: boolean;
  batchId?: number | null;
  assignedWorkerId?: number | null;
  processingDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
  itemSummary?: string | null;
  items?: OrderItem[];
  priceAdjustments?: PriceAdjustment[];
}

export interface OrderInput {
  customerName: string;
  phone: string;
  address?: string;
  customerId?: number;
  serviceType?: "standard" | "express" | "premium";
  items?: { serviceId: number; quantity: number }[];
  shirts?: number;
  trousers?: number;
  additionalNotes?: string;
  price?: number;
  extraCharge?: number;
  extraChargeReason?: string;
  discount?: number;
  discountReason?: string;
  branchId?: number;
}

export interface OrderUpdate {
  status?: "pending" | "processing" | "ready" | "partial_pickup" | "completed";
  paymentStatus?: "unpaid" | "partial" | "paid";
  price?: number;
  extraCharge?: number;
  discount?: number;
  verifiedShirts?: number;
  verifiedTrousers?: number;
  isVerified?: boolean;
  additionalNotes?: string;
  assignedWorkerId?: number | null;
}

export interface PaymentRecord {
  id: number;
  orderId: number;
  laundryId?: number | null;
  receiptNumber?: string | null;
  amount: number;
  method: "cash" | "transfer" | "pos";
  notes?: string | null;
  remainingBalance: number;
  recordedBy?: string | null;
  recordedAt: string;
}

export interface PaymentInput {
  amount: number;
  method: "cash" | "transfer" | "pos";
  notes?: string;
}

export interface OrderItem {
  id: number;
  orderId: number;
  serviceId?: number | null;
  serviceType: "standard" | "express" | "premium";
  name: string;
  quantity: number;
  quantityPickedUp: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: string;
}

export interface OrderItemInput {
  serviceId?: number;
  serviceType: "standard" | "express" | "premium";
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PriceAdjustment {
  id: number;
  orderId: number;
  laundryId?: number | null;
  type: "discount" | "extra_charge";
  amount: string;
  reason: string;
  appliedBy: string;
  createdAt: string;
}

export interface PriceAdjustmentInput {
  type: "discount" | "extra_charge";
  amount: number;
  reason: string;
}

export interface PickupItemInput {
  orderItemId: number;
  quantity: number;
}

export interface PickupInput {
  items?: PickupItemInput[];
  shirtsPickedUp?: number;
  trousersPickedUp?: number;
  notes?: string;
}

export interface PickupResponse {
  pickup: PickupRecord;
  order: {
    status: string;
    shirtsPickedUp: number;
    trousersPickedUp: number;
    remainingShirts: number;
    remainingTrousers: number;
    allPickedUp: boolean;
    fullyPaid: boolean;
    items?: { id: number; name: string; quantity: number; quantityPickedUp: number; remaining: number }[] | null;
  };
}

export interface PickupRecord {
  id: number;
  laundryId?: number | null;
  orderId: number;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  itemPickups?: { orderItemId: number; quantity: number; name: string }[] | null;
  notes?: string | null;
  processedBy?: number | null;
  recordedBy?: string | null;
  createdAt: string;
}

export interface OrdersSummary {
  total: number;
  pending: number;
  processing: number;
  ready: number;
  partialPickup: number;
  completed: number;
  unpaid: number;
  partial: number;
  paid: number;
  totalRevenue: number;
  pendingRevenue: number;
  collectedRevenue: number;
}

export interface Service {
  id: number;
  laundryId?: number | null;
  name: string;
  category: string;
  standardPrice: number;
  expressPrice?: number | null;
  premiumPrice?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceInput {
  name: string;
  category: string;
  standardPrice: number;
  expressPrice?: number;
  premiumPrice?: number;
  isActive?: boolean;
}

export interface Batch {
  id: number;
  laundryId?: number | null;
  batchCode: string;
  status: "active" | "completed";
  orderCount: number;
  createdAt: string;
}

export interface BatchWithOrders extends Batch {
  orders: Order[];
}

export interface BatchInput {
  orderIds: number[];
  assignedWorkerId?: number;
}

export interface AnalyticsOverview {
  totalOrders: number;
  totalRevenue: number;
  collectedRevenue: number;
  pendingRevenue: number;
  ordersThisWeek: number;
  ordersLastWeek: number;
  weeklyGrowthPercent: number;
  ordersThisMonth: number;
  activeBatches: number;
  delayedOrders: number;
  totalExpenses: number;
  estimatedProfit: number;
}

export interface DailyStats {
  date: string;
  count: number;
  revenue: number;
}

export type AnalyticsPeriod = "today" | "7d" | "30d" | "90d";

export interface FullAnalytics {
  period: AnalyticsPeriod;
  overview: {
    totalRevenue: number;
    collectedRevenue: number;
    outstandingBalance: number;
    avgOrderValue: number;
    totalOrders: number;
    activeOrders: number;
    completedOrders: number;
    partialPickup: number;
    delayedOrders: number;
    totalRemainingItems: number;
    totalExpenses: number;
    estimatedProfit: number;
  };
  growth: { revenue: number; orders: number; collected: number };
  statusCounts: { pending: number; processing: number; ready: number; partial_pickup: number; completed: number };
  paymentCounts: { unpaid: number; partial: number; paid: number };
  trends: { date: string; revenue: number; collected: number; orders: number }[];
  expenses: { total: number; byCategory: Record<string, number> };
  alerts: {
    delayedOrders: { id: number; orderId: string; customerName: string; status: string; daysOld: number }[];
    unpaidCount: number;
    partialPickupCount: number;
  };
}

export interface CustomerAnalytics {
  segments: {
    total: number;
    vip: number;
    repeat: number;
    inactive: number;
    newThisMonth: number;
    withBalance: number;
    totalOutstanding: number;
  };
  topSpenders: {
    id: number;
    fullName: string;
    phone: string;
    totalOrders: number;
    totalSpending: number;
    outstandingBalance: number;
    isVip: boolean;
    isRepeat: boolean;
  }[];
}

export interface WorkerAnalytics {
  workers: {
    id: number;
    name: string;
    role: string;
    isActive: boolean;
    totalAssigned: number;
    recentAssigned: number;
    completed: number;
    active: number;
    pickupsProcessed: number;
    recentPickups: number;
  }[];
  unassignedOrders: number;
}

export interface Customer {
  id: number;
  laundryId: number;
  fullName: string;
  phone: string;
  address?: string | null;
  notes?: string | null;
  createdAt: string;
  lastActivityAt: string;
}

export interface CustomerMetrics {
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  totalSpending: number;
  totalPaid: number;
  outstandingBalance: number;
  avgOrderValue: number;
  remainingItems: number;
  lastOrderDate: string | null;
  isVip: boolean;
  isRepeat: boolean;
  hasBalance: boolean;
  hasRemainingPickups: boolean;
  tags: string[];
}

export interface CustomerWithMetrics extends Customer, CustomerMetrics {}

export interface CustomerProfile extends CustomerWithMetrics {
  orders: Order[];
}

export interface StatementEntry {
  date: string;
  type: "order" | "payment" | "discount" | "extra_charge" | "pickup";
  description: string;
  orderId: string;
  orderDbId: number;
  receiptNumber?: string | null;
  charge: number;
  credit: number;
  balance: number;
  recordedBy?: string | null;
  method?: string | null;
}

export interface CustomerStatement {
  customer: { id: number; fullName: string; phone: string; address?: string | null };
  period: { from: string; to: string };
  entries: StatementEntry[];
  summary: {
    totalCharged: number;
    totalPaid: number;
    closingBalance: number;
    orderCount: number;
    paymentCount: number;
  };
}

export interface CustomerInput {
  fullName: string;
  phone: string;
  address?: string;
  notes?: string;
}

export interface CustomerUpdateInput {
  fullName?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
}

export interface Worker {
  id: number;
  laundryId?: number | null;
  branchId?: number | null;
  name: string;
  phone?: string | null;
  role: "admin" | "worker";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerInput {
  name: string;
  phone: string;
  role?: "admin" | "worker";
  pin: string;
  isActive?: boolean;
  branchId?: number | null;
}

export type NotificationEventType =
  | "new_order" | "order_assigned" | "due_soon" | "overdue"
  | "payment_received" | "unpaid_balance" | "order_ready"
  | "partial_pickup" | "pickup_completed" | "high_expense" | "low_profit_warning";

export type NotificationSeverity = "info" | "warning" | "urgent" | "success";

export interface Notification {
  id: number;
  laundryId: number;
  targetType: "owner" | "worker" | "all";
  targetWorkerId?: number | null;
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  isRead: boolean;
  relatedOrderId?: number | null;
  createdAt: string;
}

export type ExpenseCategory =
  | "electricity" | "detergent" | "water" | "salaries"
  | "transport" | "maintenance" | "packaging" | "miscellaneous";

export interface Expenditure {
  id: number;
  laundryId: number;
  category: ExpenseCategory;
  amount: string;
  notes?: string | null;
  isRecurring: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenditureInput {
  category: ExpenseCategory;
  amount: number;
  notes?: string;
  isRecurring?: boolean;
}

export interface ExpenditureSummary {
  total: number;
  byCategory: Record<string, number>;
  count: number;
  period: string;
}

export interface BusinessProfile {
  businessName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  email?: string;
  logoUrl?: string;
  notes?: string;
}

export interface BrandingSettings {
  brandColor?: string;
  receiptHeaderName?: string;
  receiptFooterText?: string;
}

export interface OperationalSettings {
  standardTurnaroundHours?: number;
  expressTurnaroundHours?: number;
  premiumTurnaroundHours?: number;
  workingDays?: string[];
  workingHoursStart?: string;
  workingHoursEnd?: string;
  requireItemVerification?: boolean;
  autoAssignOrders?: boolean;
  allowPartialPickup?: boolean;
  allowWorkersCreateCustomers?: boolean;
  allowWorkersRecordPayments?: boolean;
}

export interface AutomationSettings {
  orderReadyAlerts?: boolean;
  paymentReminderAlerts?: boolean;
  pickupReminderAlerts?: boolean;
  overdueAlerts?: boolean;
  dueSoonAlerts?: boolean;
}

export interface DashboardPreferences {
  showRevenue?: boolean;
  showExpenses?: boolean;
  showProfit?: boolean;
  showWorkerPerformance?: boolean;
  showNotifications?: boolean;
  showOperationalInsights?: boolean;
}

export interface DiscountSettings {
  maxDiscountPerOrder?: number;
  maxDiscountPercentage?: number;
  autoApprovalThreshold?: number;
}

export interface WorkerPermission {
  workerId: number;
  canViewCustomers: boolean;
  canCreateCustomers: boolean;
  canViewCustomerBalances: boolean;
  canRecordPayments: boolean;
  canRecordPickups: boolean;
  canViewOrders: boolean;
  canProcessOrders: boolean;
  canAssignOrders: boolean;
}

export interface NotifTemplate {
  id: number;
  laundryId: number;
  branchId: number | null;
  eventTrigger: string;
  channel: string;
  name: string;
  body: string;
  variables: string[] | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotifTemplateInput {
  eventTrigger: string;
  channel: string;
  name: string;
  body: string;
  branchId?: number | null;
  variables?: string[];
  isActive?: boolean;
}

export interface NotifMessage {
  id: number;
  eventId: number | null;
  templateId: number | null;
  channel: string;
  recipientPhone: string;
  recipientName: string | null;
  renderedBody: string;
  status: string;
  providerMessageId: string | null;
  retryCount: number;
  errorMessage: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

export interface NotifEvent {
  id: number;
  laundryId: number;
  branchId: number | null;
  eventType: string;
  orderId: number | null;
  customerId: number | null;
  customerPhone: string | null;
  customerName: string | null;
  status: string;
  skipReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotifStats {
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  templates: { total: number; active: number };
}

export interface WaProviderConfig {
  isConfigured: boolean;
  isActive?: boolean;
  isVerified?: boolean;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
  phoneNumberId?: string;
  accessTokenSaved?: boolean;
  accessTokenMasked?: string;
  businessAccountId?: string;
  webhookVerifyToken?: string;
  appSecretSaved?: boolean;
  appSecretMasked?: string;
  apiVersion?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
}

export interface WaConfigInput {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  appSecret?: string;
  apiVersion?: string;
}

export interface WaValidateResult {
  valid: boolean;
  error?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
}

export interface TestMessageResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  messageId?: number;
}

export interface MessageTemplate {
  id: number;
  name: string;
  subject?: string | null;
  body: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateInput {
  name?: string;
  subject?: string;
  body?: string;
  isActive?: boolean;
}

export interface ReceiptListItem {
  id: number;
  receiptNumber: string | null;
  orderId: number;
  orderRef: string;
  customerName: string;
  phone: string;
  customerId?: number | null;
  amount: string;
  method: string;
  remainingBalance: string;
  recordedBy?: string | null;
  recordedAt: string;
  paymentStatus: string;
}

export interface ReceiptListResponse {
  receipts: ReceiptListItem[];
  total: number;
  totalCollected: number;
  totalBalance: number;
}

export interface OpsAuditEntry {
  id: number;
  actorId?: number | null;
  actorType: "owner" | "worker";
  actorName: string;
  action: string;
  orderId?: number | null;
  orderRef?: string | null;
  customerName?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OpsAuditLogResponse {
  entries: OpsAuditEntry[];
  total: number;
}

export interface OpsPaymentEntry {
  id: number;
  receiptNumber?: string | null;
  amount: string;
  method: string;
  notes?: string | null;
  remainingBalance: string;
  recordedBy?: string | null;
  recordedAt: string;
  branchId?: number | null;
  branchName?: string | null;
  orderId: number;
  orderRef?: string | null;
  customerName?: string | null;
  phone?: string | null;
  workerName?: string | null;
}

export interface OpsPaymentsResponse {
  payments: OpsPaymentEntry[];
  total: number;
  totalAmount: string;
}

export interface OpsPickupEntry {
  id: number;
  orderId: number;
  orderRef?: string | null;
  customerName?: string | null;
  phone?: string | null;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  itemPickups?: { orderItemId: number; quantity: number; name: string }[] | null;
  notes?: string | null;
  recordedBy?: string | null;
  workerName?: string | null;
  createdAt: string;
}

export interface OpsPickupsResponse {
  pickups: OpsPickupEntry[];
  total: number;
}

export interface OpsWorkerActivityResponse {
  entries: OpsAuditEntry[];
  total: number;
  summary: { actorName: string; actorId?: number | null; count: number }[];
}

export interface OpsHealthResponse {
  orders: { byStatus: { status: string; count: number }[] };
  payments: {
    byMethod: { method: string; count: number; total: string }[];
    last24h: number;
  };
  pickups: { last24h: number };
  topActions: { action: string; count: number }[];
  generatedAt: string;
}

export interface HeartbeatInput {
  deviceId: string;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  recoveryCount: number;
  isOnline: boolean;
  appVersion: string;
  lastSyncedAt: string | null;
}

export interface OpsSyncHealthDevice {
  id: number;
  deviceId: string;
  actorType: "owner" | "worker";
  workerName: string | null;
  workerId: number | null;
  branchId: number | null;
  branchName: string | null;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  recoveryCount: number;
  isOnline: boolean;
  appVersion: string | null;
  lastSyncedAt: string | null;
  lastSeenAt: string;
  createdAt: string;
  staleness: "fresh" | "stale" | "very_stale";
  minutesSinceLastSeen: number;
}

export interface OpsSyncHealthResponse {
  devices: OpsSyncHealthDevice[];
  summary: {
    total: number;
    active: number;
    stale: number;
    veryStale: number;
    withConflicts: number;
    withPending: number;
    withFailed: number;
    offline: number;
  };
  generatedAt: string;
}

export interface FailedMessageEntry {
  id: number;
  templateName: string;
  recipientPhone: string;
  recipientName: string | null;
  channel: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  notificationEventId: number | null;
  createdAt: string;
}

export interface OpsFailedMessagesResponse {
  entries: FailedMessageEntry[];
  total: number;
}

export interface DRCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  critical: boolean;
}

export interface DRReadiness {
  score: number;
  grade: string;
  checks: DRCheck[];
  lastBackup: {
    timestamp: string;
    file: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
    ageHours: number;
  } | null;
  dbStats: {
    tables: number;
    indexes: number;
    sizeBytes: number;
    sizePretty: string;
  };
  softDeleteStats: {
    workers: number;
    customers: number;
    branches: number;
    payments: number;
    total: number;
  };
  generatedAt: string;
}

export interface BackupFile {
  file: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  timestamp: string;
  ageHours: number | null;
}

export interface BackupTriggerResult {
  success: boolean;
  output: string;
  manifest: BackupFile | null;
  error?: string;
  detail?: string;
}

export interface BackupVerifyResult {
  success: boolean;
  output: string;
  passed: number;
  failed: number;
  file?: string;
  error?: string;
}

export interface SchemaSnapshot {
  id: number;
  snapshotType: string;
  triggeredBy: string | null;
  tableCount: number | null;
  indexCount: number | null;
  dbSizeBytes: number | null;
  tableList: string | null;
  notes: string | null;
  createdAt: string;
}

export interface RecoverySummary {
  workers: number;
  customers: number;
  branches: number;
  payments: number;
  total: number;
}

export interface DeletedWorker {
  id: number;
  name: string;
  phone?: string | null;
  role: string;
  branchId?: number | null;
  deletedAt: string;
  deletedByName?: string | null;
  deletedByType?: string | null;
  createdAt: string;
}

export interface DeletedCustomer {
  id: number;
  fullName: string;
  phone: string;
  branchId?: number | null;
  deletedAt: string;
  deletedByName?: string | null;
  deletedByType?: string | null;
  createdAt: string;
}

export interface DeletedBranch {
  id: number;
  name: string;
  address?: string | null;
  deletedAt: string;
  deletedByName?: string | null;
  deletedByType?: string | null;
  createdAt: string;
}

export interface DeletedPayment {
  id: number;
  orderId: number;
  receiptNumber?: string | null;
  amount: string;
  method: string;
  recordedBy?: string | null;
  recordedAt: string;
  deletedAt: string;
  deletedByName?: string | null;
  deletedByType?: string | null;
}

export interface AuditLogEntry {
  id: number;
  laundryId?: number | null;
  actorId?: number | null;
  actorType: "owner" | "worker";
  actorName: string;
  action: string;
  orderId?: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type MessageDeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface OrderMessage {
  id: number;
  channel: string;
  recipientPhone: string;
  recipientName: string | null;
  renderedBody: string;
  status: MessageDeliveryStatus;
  providerMessageId: string | null;
  retryCount: number;
  errorMessage: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface DiscountApproval {
  id: number;
  laundryId?: number | null;
  orderId: number;
  requestedBy?: number | null;
  requestedByName: string;
  originalAmount: string;
  requestedDiscount: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface ExpenseCategoryRecord {
  id: number;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface SlaSettings {
  standardTurnaroundHours: number;
  expressTurnaroundHours: number;
  premiumTurnaroundHours: number;
}

export interface SlaAnalytics {
  avgCompletionHours: number | null;
  overdueCount: number;
  dueSoonCount: number;
  onTimeRate: number;
  totalCompleted: number;
  totalActive: number;
  byServiceType: Record<string, { count: number; overdueCount: number; avgHours: number | null }>;
}

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertCategory =
  | "sync"
  | "backup"
  | "recovery"
  | "payment"
  | "pickup"
  | "worker"
  | "system"
  | "version"
  | "security"
  | "subscription";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface AlertRecord {
  id: number;
  laundryId: number | null;
  branchId: number | null;
  deviceId: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  status: AlertStatus;
  fingerprint: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AlertsListResponse {
  alerts: AlertRecord[];
  total: number;
}

export interface AlertCounts {
  critical: number;
  warning: number;
  info: number;
  unresolved: number;
  open: number;
  acknowledged: number;
  resolved: number;
}

export interface SubscriptionStatus {
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  plan: string;
  planDisplayName: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  graceDaysRemaining: number | null;
  convertedAt: string | null;
  subscriptionRenewsAt: string | null;
  features: {
    HAS_WHATSAPP: boolean;
    HAS_MULTI_BRANCH: boolean;
    HAS_MARKETING_TOOLS: boolean;
    HAS_ANALYTICS: boolean;
    HAS_BATCH_PROCESSING: boolean;
  };
  limits: {
    maxBranches: number;
    maxWorkers: number;
    maxOrdersPerMonth: number;
  };
}

export interface PlanPricingConfig {
  tier: string;
  displayName: string;
  tagline: string;
  price: {
    monthly: number;
    annual: number;
    annualSavingsPct: number;
    currency: string;
  };
  features: string[];
  highlighted: boolean;
  paystackPlanCode?: string;
}

export interface SubscriptionPricing {
  plans: PlanPricingConfig[];
  paymentInstructions: {
    bankName: string;
    contactWhatsApp: string;
    contactEmail: string;
    instructions: string[];
  };
  currency: string;
}

export type UsageWarningLevel = "safe" | "warning_70" | "warning_85" | "critical_100";

// ── WhatsApp Connection ────────────────────────────────────────────────────

export type WaConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      phoneNumberId: string;
      whatsappBusinessAccountId: string;
      displayPhoneNumber: string | null;
      businessName: string | null;
      connectedAt: string;
    };

export interface WaConnectInput {
  whatsappBusinessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string;
  businessName?: string;
}

export type WaMetaConfig =
  | { available: false }
  | { available: true; appId: string; configId: string };

export interface WaMetaCallbackInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string;
  channel: "whatsapp" | "sms";
  status: "open" | "resolved" | "archived";
  unreadCount: number;
  lastMessageAt: string | null;
  assignedWorkerId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: number;
  conversationId: number;
  laundryId: number;
  direction: "inbound" | "outbound";
  body: string;
  status: string | null;
  providerMessageId: string | null;
  senderType: string | null;
  senderName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessage[];
  customer: { id: number; fullName: string; phone: string } | null;
}

export interface ConversationListResponse {
  conversations: Conversation[];
  total: number;
  totalUnread: number;
}

export const api = {
  ...api,
  conversations: {
    list: async (params?: {
      status?: "open" | "resolved" | "archived";
      limit?: number;
      offset?: number;
    }): Promise<ConversationListResponse> => {
      const q = new URLSearchParams();
      if (params?.status) q.set("status", params.status);
      if (params?.limit != null) q.set("limit", String(params.limit));
      if (params?.offset != null) q.set("offset", String(params.offset));
      const res = await fetch(`/api/conversations?${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },

    getUnreadCount: async (): Promise<{ unreadCount: number }> => {
      const res = await fetch("/api/conversations/unread-count", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },

    get: async (id: number): Promise<ConversationDetail> => {
      const res = await fetch(`/api/conversations/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },

    markRead: async (id: number): Promise<void> => {
      const res = await fetch(`/api/conversations/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
    },

    updateStatus: async (
      id: number,
      status: "open" | "resolved" | "archived"
    ): Promise<void> => {
      const res = await fetch(`/api/conversations/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
  },
};

export interface SubscriptionUsage {
  monthlyOrderCount: number;
  activeWorkerCount: number;
  activeBranchCount: number;
  storageUsedMb: number;
  plan: string;
  limits: {
    maxOrdersPerMonth: number;
    maxWorkers: number;
    maxBranches: number;
    maxStorageMb: number;
  };
  percentages: {
    orders: number;
    workers: number;
    branches: number;
    storage: number;
  };
  warnings: {
    orders: UsageWarningLevel;
    workers: UsageWarningLevel;
    branches: UsageWarningLevel;
    storage: UsageWarningLevel;
  };
}
