import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Database,
  Server,
  Shield,
  HardDrive,
  Wifi,
  WifiOff,
  Monitor,
  Clock,
  AlertTriangle,
  TrendingUp,
  Users,
  ShoppingCart,
  UserCircle,
} from "lucide-react";

interface ProductionHealthData {
  overallStatus: "healthy" | "warning" | "critical";
  generatedAt: string;
  latencyMs: number;
  api: {
    status: string;
    uptimeMs: number;
    nodeVersion: string;
    latencyMs: number;
  };
  database: {
    status: string;
    latencyMs: number;
    tables: number;
    sizeBytes: number;
    sizePretty: string;
  };
  backup: {
    status: "healthy" | "warning" | "critical";
    lastBackup: {
      file: string;
      sizeBytes: number;
      sha256: string;
      createdAt: string;
      ageHours: number;
      hmacSigned: boolean;
      scheduledRun: boolean;
    } | null;
    backupCount: number;
  };
  alerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    items: Array<{
      id: number;
      severity: string;
      category: string;
      title: string;
      message: string;
      createdAt: string;
    }>;
  };
  devices: {
    activeNow: number;
    activeLast24h: number;
    failedJobDevices: number;
    items: Array<{
      deviceId: string;
      userType: string;
      userName: string;
      syncStatus: string;
      pendingCount: number;
      failedCount: number;
      lastSeenAt: string;
      appVersion: string;
    }>;
  };
  sync: {
    status: string;
    pendingJobs: number;
    failedJobs: number;
  };
  business: {
    laundryId: number;
    businessName: string;
    subscriptionStatus: string;
    trialEndsAt: string | null;
    ordersLast30d: number;
    activeWorkers: number;
    totalCustomers: number;
  };
}

function StatusDot({ status }: { status: "healthy" | "warning" | "critical" | string }) {
  if (status === "healthy") return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === "warning") return <AlertCircle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status }: { status: "healthy" | "warning" | "critical" | string }) {
  if (status === "healthy") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Healthy</Badge>;
  if (status === "warning") return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Warning</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Critical</Badge>;
}

function OverallStatusBanner({ status, latencyMs }: { status: string; latencyMs: number }) {
  const config = {
    healthy: {
      bg: "bg-emerald-500/10 border-emerald-500/30",
      icon: <CheckCircle className="h-6 w-6 text-emerald-400" />,
      text: "text-emerald-400",
      label: "All Systems Operational",
      sub: "Platform is running normally.",
    },
    warning: {
      bg: "bg-amber-500/10 border-amber-500/30",
      icon: <AlertCircle className="h-6 w-6 text-amber-400" />,
      text: "text-amber-400",
      label: "Attention Required",
      sub: "Some systems need review.",
    },
    critical: {
      bg: "bg-red-500/10 border-red-500/30",
      icon: <XCircle className="h-6 w-6 text-red-400" />,
      text: "text-red-400",
      label: "Critical Issues Detected",
      sub: "Immediate action required.",
    },
  }[status] ?? {
    bg: "bg-slate-500/10 border-slate-500/30",
    icon: <AlertCircle className="h-6 w-6 text-slate-400" />,
    text: "text-slate-400",
    label: "Status Unknown",
    sub: "",
  };

  return (
    <div className={`rounded-xl border p-5 flex items-center gap-4 ${config.bg}`}>
      {config.icon}
      <div className="flex-1">
        <p className={`text-lg font-bold ${config.text}`}>{config.label}</p>
        <p className="text-sm text-muted-foreground">{config.sub}</p>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <p>Response: {latencyMs}ms</p>
      </div>
    </div>
  );
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function formatAgeHours(h: number) {
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function PlatformHealthPage() {
  usePageTitle("Platform Health");
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery<ProductionHealthData>({
    queryKey: ["platform-health"],
    queryFn: () => api.health.production() as Promise<ProductionHealthData>,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-20 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <XCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-semibold">Failed to load health data</p>
          <p className="text-sm text-muted-foreground mt-1">The health endpoint could not be reached.</p>
          <Button onClick={() => refetch()} variant="outline" className="mt-4">Retry</Button>
        </div>
      </div>
    );
  }

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform Health</h1>
          <p className="text-muted-foreground text-sm">
            {data.business.businessName} · Last updated {lastUpdated}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall Status */}
      <OverallStatusBanner status={data.overallStatus} latencyMs={data.latencyMs} />

      {/* Core System Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* API Server */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="h-4 w-4" /> API Server
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge status={data.api.status} />
              <span className="text-xs text-muted-foreground">{data.api.latencyMs}ms</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Uptime</span>
                <span className="text-foreground font-medium">{formatUptime(data.api.uptimeMs)}</span>
              </div>
              <div className="flex justify-between">
                <span>Node</span>
                <span className="text-foreground font-medium">{data.api.nodeVersion}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4" /> Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge status={data.database.status} />
              <span className="text-xs text-muted-foreground">{data.database.latencyMs}ms</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Tables</span>
                <span className="text-foreground font-medium">{data.database.tables}</span>
              </div>
              <div className="flex justify-between">
                <span>Size</span>
                <span className="text-foreground font-medium">{data.database.sizePretty}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <HardDrive className="h-4 w-4" /> Backup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusBadge status={data.backup.status} />
              <span className="text-xs text-muted-foreground">{data.backup.backupCount} file(s)</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {data.backup.lastBackup ? (
                <>
                  <div className="flex justify-between">
                    <span>Last backup</span>
                    <span className="text-foreground font-medium">
                      {formatAgeHours(data.backup.lastBackup.ageHours ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>HMAC signed</span>
                    <span className={data.backup.lastBackup.hmacSigned ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                      {data.backup.lastBackup.hmacSigned ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Scheduled run</span>
                    <span className={data.backup.lastBackup.scheduledRun ? "text-emerald-400 font-medium" : "text-amber-400 font-medium"}>
                      {data.backup.lastBackup.scheduledRun ? "Yes" : "Manual"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-red-400 font-medium">No backup found</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Shield className="h-4 w-4" /> Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {data.alerts.total === 0 ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">No open alerts</Badge>
              ) : (
                <>
                  {data.alerts.critical > 0 && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{data.alerts.critical} critical</Badge>
                  )}
                  {data.alerts.warning > 0 && (
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{data.alerts.warning} warning</Badge>
                  )}
                  {data.alerts.info > 0 && (
                    <Badge variant="outline">{data.alerts.info} info</Badge>
                  )}
                </>
              )}
            </div>
            {data.alerts.items.slice(0, 2).map((a) => (
              <div key={a.id} className="text-xs border-l-2 border-red-500/40 pl-2">
                <p className="text-foreground font-medium truncate">{a.title}</p>
                <p className="text-muted-foreground truncate">{a.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Devices */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Monitor className="h-4 w-4" /> Active Devices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {data.devices.activeNow > 0 ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-2xl font-bold">{data.devices.activeNow}</span>
              <span className="text-xs text-muted-foreground">online now</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Last 24h</span>
                <span className="text-foreground font-medium">{data.devices.activeLast24h}</span>
              </div>
              {data.devices.failedJobDevices > 0 && (
                <div className="flex justify-between">
                  <span>Devices with failed jobs</span>
                  <span className="text-red-400 font-medium">{data.devices.failedJobDevices}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sync */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <RefreshCw className="h-4 w-4" /> Sync Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusBadge status={data.sync.status} />
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Pending jobs</span>
                <span className="text-foreground font-medium">{data.sync.pendingJobs}</span>
              </div>
              <div className="flex justify-between">
                <span>Failed jobs</span>
                <span className={data.sync.failedJobs > 0 ? "text-red-400 font-medium" : "text-emerald-400 font-medium"}>
                  {data.sync.failedJobs}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Business Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Business Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <ShoppingCart className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-2xl font-bold">{data.business.ordersLast30d}</p>
              <p className="text-xs text-muted-foreground">Orders (30d)</p>
            </div>
            <div className="text-center">
              <Users className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-2xl font-bold">{data.business.activeWorkers}</p>
              <p className="text-xs text-muted-foreground">Active Workers</p>
            </div>
            <div className="text-center">
              <UserCircle className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-2xl font-bold">{data.business.totalCustomers}</p>
              <p className="text-xs text-muted-foreground">Total Customers</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Open Alerts Detail */}
      {data.alerts.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Open Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.alerts.items.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border">
                  <StatusDot status={alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "warning" : "healthy"} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <Badge variant="outline" className="text-xs capitalize">{alert.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(alert.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Devices Detail */}
      {data.devices.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4 w-4" /> Device Activity (Last 24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.devices.items.slice(0, 10).map((device) => {
                const isOnline = new Date(device.lastSeenAt).getTime() > Date.now() - 5 * 60 * 1000;
                return (
                  <div key={device.deviceId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                    <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{device.userName ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground capitalize">{device.userType}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {device.failedCount > 0 && (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs mr-1">
                          {device.failedCount} failed
                        </Badge>
                      )}
                      {device.pendingCount > 0 && (
                        <Badge variant="outline" className="text-xs mr-1">
                          {device.pendingCount} pending
                        </Badge>
                      )}
                      <Clock className="h-3 w-3 inline mr-1" />
                      {new Date(device.lastSeenAt).toLocaleTimeString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-xs text-muted-foreground text-center pb-4">
        Auto-refreshes every 60 seconds · Generated at {new Date(data.generatedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
