import Dexie, { type Table } from "dexie";

export interface LocalCustomer {
  localId: string;
  serverId: number | null;
  laundryId: number;
  branchId: number | null;
  fullName: string;
  phone: string;
  address: string | null;
  notes: string | null;
  syncStatus: "synced" | "pending_create" | "pending_update";
  createdAt: string;
  updatedAt: string;
}

export interface LocalOrderItem {
  localId: string;
  orderLocalId: string;
  orderId: number | null;
  serviceId: number;
  serviceType: string;
  name: string;
  quantity: number;
  quantityPickedUp: number;
  unitPrice: number;
  totalPrice: number;
  syncStatus: "synced" | "pending";
}

export interface LocalOrder {
  localId: string;
  serverId: number | null;
  laundryId: number;
  branchId: number | null;
  customerLocalId: string | null;
  customerId: number | null;
  orderId: string | null;
  customerName: string;
  phone: string;
  address: string | null;
  serviceType: "standard" | "express" | "premium";
  status: string;
  paymentStatus: string;
  price: number | null;
  extraCharge: number | null;
  discount: number | null;
  amountPaid: number;
  additionalNotes: string | null;
  syncStatus: "synced" | "pending_create" | "pending_status_update";
  createdAt: string;
  updatedAt: string;
}

export interface LocalPayment {
  localId: string;
  orderLocalId: string;
  orderId: number | null;
  laundryId: number;
  branchId: number | null;
  amount: number;
  method: "cash" | "transfer" | "pos";
  notes: string | null;
  receiptNumber: string | null;
  syncStatus: "synced" | "pending_create" | "conflict";
  createdAt: string;
}

export interface LocalPickup {
  localId: string;
  orderLocalId: string;
  orderId: number | null;
  laundryId: number;
  items: Array<{ orderItemLocalId: string; quantity: number; name: string }>;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  notes: string | null;
  /**
   * "synced"        — successfully posted to the server
   * "pending_create" — queued locally, waiting for sync
   * "conflict"      — permanently failed due to a quantity mismatch or invalid
   *                   order status; will not be retried automatically
   */
  syncStatus: "synced" | "pending_create" | "conflict";
  createdAt: string;
}

export interface LocalService {
  localId: string;
  serverId: number;
  laundryId: number;
  name: string;
  serviceType: "standard" | "express" | "premium";
  price: number;
  unit: string;
  isActive: boolean;
  cachedAt: string;
}

export type SyncOperation =
  | "create_customer"
  | "create_order"
  | "record_payment"
  | "record_pickup"
  | "update_order_status";

export interface SyncQueueEntry {
  id?: number;
  clientId: string;
  position: number;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  localId: string;
  dependsOn: string[];
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  status: "pending" | "in_flight" | "failed" | "done";
  createdAt: string;
}

export interface SyncLogEntry {
  id?: number;
  operation: string;
  localId: string;
  serverId: number | null;
  success: boolean;
  error: string | null;
  syncedAt: string;
}

export interface MetadataEntry {
  key: string;
  value: string | number;
}

class CleanTrackDB extends Dexie {
  customers!: Table<LocalCustomer, string>;
  orders!: Table<LocalOrder, string>;
  orderItems!: Table<LocalOrderItem, string>;
  payments!: Table<LocalPayment, string>;
  pickups!: Table<LocalPickup, string>;
  services!: Table<LocalService, string>;
  syncQueue!: Table<SyncQueueEntry, number>;
  syncLog!: Table<SyncLogEntry, number>;
  metadata!: Table<MetadataEntry, string>;

  constructor() {
    super("cleantrack_local_v1");

    this.version(1).stores({
      customers:
        "localId, serverId, phone, branchId, syncStatus, laundryId",
      orders:
        "localId, serverId, branchId, status, syncStatus, laundryId, createdAt",
      orderItems:
        "localId, orderLocalId, orderId",
      payments:
        "localId, orderLocalId, orderId, syncStatus, laundryId",
      pickups:
        "localId, orderLocalId, orderId, syncStatus",
      services:
        "localId, serverId, laundryId, serviceType, isActive",
      syncQueue:
        "++id, clientId, status, position, operation, localId, createdAt",
      syncLog:
        "++id, localId, success, syncedAt, operation",
      metadata:
        "key",
    });
  }
}

export const localDb = new CleanTrackDB();

export async function getMetadata(key: string): Promise<string | number | null> {
  const entry = await localDb.metadata.get(key);
  return entry?.value ?? null;
}

export async function setMetadata(key: string, value: string | number): Promise<void> {
  await localDb.metadata.put({ key, value });
}
