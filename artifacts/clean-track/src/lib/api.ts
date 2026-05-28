const BASE_URL = "/api";
const TOKEN_KEY = "ct_token";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("ct_user");
    window.location.href = "/login";
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    signup: (data: SignupInput) => request<AuthResponse>("POST", "/auth/signup", data),
    ownerLogin: (data: OwnerLoginInput) => request<AuthResponse>("POST", "/auth/owner-login", data),
    workerLogin: (data: WorkerLoginInput) => request<WorkerAuthResponse>("POST", "/auth/worker-login", data),
    me: () => request<AuthUser>("GET", "/auth/me"),
  },
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
    full: (period: AnalyticsPeriod) => request<FullAnalytics>("GET", `/analytics/full?period=${period}`),
    customerAnalytics: () => request<CustomerAnalytics>("GET", "/analytics/customers"),
    workerAnalytics: () => request<WorkerAnalytics>("GET", "/analytics/workers"),
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
    record: (orderId: number, data: PickupInput) => request<{ pickup: PickupRecord; order: { status: string; shirtsPickedUp: number; trousersPickedUp: number; remainingShirts: number; remainingTrousers: number; allPickedUp: boolean; fullyPaid: boolean } }>("POST", `/orders/${orderId}/pickups`, data),
  },
  customers: {
    list: (params?: { search?: string; tag?: string }) => {
      const qs = params ? "?" + new URLSearchParams(params as any).toString() : "";
      return request<CustomerWithMetrics[]>("GET", `/customers${qs}`);
    },
    get: (id: number) => request<CustomerProfile>("GET", `/customers/${id}`),
    create: (data: CustomerInput) => request<CustomerWithMetrics>("POST", "/customers", data),
    update: (id: number, data: CustomerUpdateInput) => request<Customer>("PATCH", `/customers/${id}`, data),
    delete: (id: number) => request<void>("DELETE", `/customers/${id}`),
    backfill: () => request<{ created: number; linked: number; message: string }>("POST", "/customers/backfill"),
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
  partialPickup: number;
  completed: number;
  unpaid: number;
  partial: number;
  paid: number;
  totalRevenue: number;
  pendingRevenue: number;
  collectedRevenue: number;
}

export interface PickupRecord {
  id: number;
  laundryId?: number | null;
  orderId: number;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  notes?: string | null;
  processedBy?: number | null;
  createdAt: string;
}

export interface PickupInput {
  shirtsPickedUp: number;
  trousersPickedUp: number;
  notes?: string;
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
  };
  growth: { revenue: number; orders: number; collected: number };
  statusCounts: { pending: number; processing: number; ready: number; partial_pickup: number; completed: number };
  paymentCounts: { unpaid: number; partial: number; paid: number };
  trends: { date: string; revenue: number; collected: number; orders: number }[];
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
}
