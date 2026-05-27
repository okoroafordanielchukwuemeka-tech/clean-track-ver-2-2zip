const BASE_URL = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  orders: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<Order[]>("GET", `/orders${qs}`);
    },
    get: (id: number) => request<Order>("GET", `/orders/${id}`),
    create: (data: OrderInput) => request<Order>("POST", "/orders", data),
    update: (id: number, data: Partial<OrderUpdate>) => request<Order>("PATCH", `/orders/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/orders/${id}`),
    summary: () => request<OrdersSummary>("GET", "/orders/summary"),
    recent: () => request<Order[]>("GET", "/orders/recent"),
    payments: (id: number) => request<PaymentRecord[]>("GET", `/orders/${id}/payments`),
    recordPayment: (id: number, data: PaymentInput) => request<PaymentRecord>("POST", `/orders/${id}/payments`, data),
    deletePayment: (id: number, paymentId: number) => request<void>("DELETE", `/orders/${id}/payments/${paymentId}`),
    items: (id: number) => request<OrderItem[]>("GET", `/orders/${id}/items`),
    addItems: (id: number, data: { items: OrderItemInput[] }) => request<Order>("POST", `/orders/${id}/items`, data),
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
  },
  workers: {
    list: () => request<Worker[]>("GET", "/workers"),
    get: (id: number) => request<Worker>("GET", `/workers/${id}`),
    create: (data: WorkerInput) => request<Worker>("POST", "/workers", data),
    update: (id: number, data: Partial<WorkerInput>) => request<Worker>("PATCH", `/workers/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/workers/${id}`),
    login: (pin: string) => request<{ worker: Worker; role: string }>("POST", "/workers/login", { pin }),
  },
};

export interface Order {
  id: number;
  orderId: string;
  customerName: string;
  phone: string;
  address?: string | null;
  serviceType: "standard" | "express" | "premium";
  shirts: number;
  trousers: number;
  additionalNotes?: string | null;
  status: "pending" | "processing" | "ready";
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
  createdAt: string;
  updatedAt: string;
}

export interface OrderInput {
  customerName: string;
  phone: string;
  address?: string;
  serviceType?: "standard" | "express" | "premium";
  shirts: number;
  trousers: number;
  additionalNotes?: string;
  price?: number;
  extraCharge?: number;
  discount?: number;
}

export interface OrderUpdate {
  status?: "pending" | "processing" | "ready";
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
  amount: number;
  method: "cash" | "transfer" | "pos";
  notes?: string | null;
  remainingBalance: number;
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

export interface OrdersSummary {
  total: number;
  pending: number;
  processing: number;
  ready: number;
  unpaid: number;
  partial: number;
  paid: number;
  totalRevenue: number;
  pendingRevenue: number;
  collectedRevenue: number;
}

export interface Service {
  id: number;
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
}

export interface DailyStats {
  date: string;
  count: number;
  revenue: number;
}

export interface Worker {
  id: number;
  name: string;
  phone?: string | null;
  role: "admin" | "worker";
  pin?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerInput {
  name: string;
  phone?: string;
  role?: "admin" | "worker";
  pin?: string;
  isActive?: boolean;
}
