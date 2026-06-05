import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const adminStorageRouter = Router();

const PROJECTED_TENANTS = [10, 100, 1000];

adminStorageRouter.get("/", async (_req, res) => {
  try {
    const [tableSizeResult, dbSizeResult, rowCountResult] = await Promise.all([
      db.execute(sql`
        SELECT
          c.relname AS table_name,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
          pg_total_relation_size(c.oid)::bigint AS total_size_bytes,
          pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
          pg_relation_size(c.oid)::bigint AS table_size_bytes,
          pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
          pg_indexes_size(c.oid)::bigint AS indexes_size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `),
      db.execute(sql`
        SELECT
          pg_database_size(current_database())::bigint AS db_size_bytes,
          pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty
      `),
      db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM laundries) AS laundries,
          (SELECT COUNT(*)::int FROM orders) AS orders,
          (SELECT COUNT(*)::int FROM order_items) AS order_items,
          (SELECT COUNT(*)::int FROM payment_records) AS payment_records,
          (SELECT COUNT(*)::int FROM audit_log) AS audit_log,
          (SELECT COUNT(*)::int FROM device_heartbeats) AS device_heartbeats,
          (SELECT COUNT(*)::int FROM alerts) AS alerts,
          (SELECT COUNT(*)::int FROM schema_snapshots) AS schema_snapshots
      `),
    ]);

    const dbSizeRow = dbSizeResult.rows[0] as { db_size_bytes: string; db_size_pretty: string } | undefined;
    const exactRow = rowCountResult.rows[0] as Record<string, number> | undefined;
    const totalBytes = Number(dbSizeRow?.db_size_bytes ?? 0);

    const tables = tableSizeResult.rows.map((t: any) => ({
      table: t.table_name as string,
      totalSize: t.total_size as string,
      totalSizeBytes: Number(t.total_size_bytes),
      tableSize: t.table_size as string,
      tableSizeBytes: Number(t.table_size_bytes),
      indexesSize: t.indexes_size as string,
      indexesSizeBytes: Number(t.indexes_size_bytes),
    }));

    // Scale projections: ~200 orders/tenant/month, ~800 bytes total overhead per order across all tables
    const ordersPerTenantPerMonth = 200;
    const bytesPerOrder = 12_000; // ~12KB total across orders, order_items, audit_log, payments
    const projections = PROJECTED_TENANTS.map((tenantCount) => {
      const monthlyOrders = tenantCount * ordersPerTenantPerMonth;
      const monthlyGrowthBytes = monthlyOrders * bytesPerOrder;
      return {
        tenants: tenantCount,
        monthlyOrders,
        monthlyGrowthEstimate: formatBytes(monthlyGrowthBytes),
        monthlyGrowthBytes,
        yearlyGrowthEstimate: formatBytes(monthlyGrowthBytes * 12),
        yearlyGrowthBytes: monthlyGrowthBytes * 12,
        recommendedRetention:
          tenantCount >= 1000
            ? "90-day order audit log, 30-day heartbeats, pg_partman for orders"
            : tenantCount >= 100
            ? "180-day audit log, 60-day heartbeats, index bloat checks monthly"
            : "1-year audit log, 90-day heartbeats, weekly VACUUM",
      };
    });

    res.json({
      database: {
        sizeBytes: totalBytes,
        sizeFormatted: dbSizeRow?.db_size_pretty ?? "unknown",
      },
      tables,
      exactCounts: {
        laundries: Number(exactRow?.laundries ?? 0),
        orders: Number(exactRow?.orders ?? 0),
        orderItems: Number(exactRow?.order_items ?? 0),
        paymentRecords: Number(exactRow?.payment_records ?? 0),
        auditLog: Number(exactRow?.audit_log ?? 0),
        deviceHeartbeats: Number(exactRow?.device_heartbeats ?? 0),
        alerts: Number(exactRow?.alerts ?? 0),
        schemaSnapshots: Number(exactRow?.schema_snapshots ?? 0),
      },
      scaleProjections: projections,
    });
  } catch (err) {
    console.error("Admin storage error:", err);
    res.status(500).json({ error: "Failed to fetch storage data" });
  }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
