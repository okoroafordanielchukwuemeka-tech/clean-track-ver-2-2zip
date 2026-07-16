import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type DiscountApproval } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Clock, ExternalLink, Percent, User, Calendar } from "lucide-react";
import { toast } from "sonner";
import { DiscountStatusBadge } from "@/lib/order-status";

const fmt = (v: number | string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));

function fmtTime(d: string) {
  return new Date(d).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function DiscountCard({ approval, onApprove, onReject, isPending }: {
  approval: DiscountApproval;
  onApprove?: () => void;
  onReject?: () => void;
  isPending?: boolean;
}) {
  const discountPct = Number(approval.originalAmount) > 0
    ? ((Number(approval.requestedDiscount) / Number(approval.originalAmount)) * 100).toFixed(1)
    : "0";

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <DiscountStatusBadge status={approval.status} />
            <span className="text-xs text-muted-foreground">{fmtTime(approval.createdAt)}</span>
          </div>
          {approval.status === "pending" && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="destructive" onClick={onReject} disabled={isPending} className="gap-1">
                <XCircle className="h-3.5 w-3.5" />Reject
              </Button>
              <Button size="sm" onClick={onApprove} disabled={isPending} className="gap-1 bg-green-600 hover:bg-green-700">
                <CheckCircle className="h-3.5 w-3.5" />Approve
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <User className="h-3 w-3" /> Worker
            </p>
            <p className="text-sm font-semibold">{approval.requestedByName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Order Total</p>
            <p className="text-sm font-semibold">{fmt(approval.originalAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <Percent className="h-3 w-3" /> Discount Requested
            </p>
            <p className="text-sm font-semibold text-amber-600">
              {fmt(approval.requestedDiscount)} ({discountPct}%)
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">New Total After</p>
            <p className="text-sm font-semibold text-green-600">
              {fmt(Math.max(0, Number(approval.originalAmount) - Number(approval.requestedDiscount)))}
            </p>
          </div>
        </div>

        <div className="p-3 bg-muted/40 rounded-lg text-sm mb-3">
          <span className="text-muted-foreground">Reason: </span>
          <span className="font-medium">"{approval.reason}"</span>
        </div>

        {approval.status !== "pending" && approval.resolvedBy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
            <Calendar className="h-3 w-3" />
            <span>{approval.status === "approved" ? "Approved" : "Rejected"} by <strong>{approval.resolvedBy}</strong>
              {approval.resolvedAt ? ` on ${fmtTime(approval.resolvedAt)}` : ""}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-2 pt-2 border-t">
          <Link
            to={`/orders/${approval.orderId}`}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> View Order
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DiscountApprovals() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const qc = useQueryClient();

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ["discount-approvals", tab],
    queryFn: () => api.discountApprovals.list(tab),
    refetchInterval: tab === "pending" ? 15_000 : false,
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["discount-approvals", "pending-count"],
    queryFn: () => api.discountApprovals.pendingCount(),
    refetchInterval: 15_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "rejected" }) =>
      api.discountApprovals.resolve(id, status),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ["discount-approvals"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(status === "approved" ? "Discount approved — order updated" : "Discount request rejected");
    },
    onError: (e: Error) => toast.error("Could not process discount request — " + (e.message || "please try again.")),
  });

  const pending = pendingCount?.count ?? 0;

  const { data: approvedData } = useQuery({
    queryKey: ["discount-approvals", "approved"],
    queryFn: () => api.discountApprovals.list("approved"),
  });
  const { data: rejectedData } = useQuery({
    queryKey: ["discount-approvals", "rejected"],
    queryFn: () => api.discountApprovals.list("rejected"),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Discount Approvals</h1>
          {pending > 0 && (
            <Badge variant="destructive" className="text-sm px-2.5 py-0.5">{pending} pending</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve or reject worker discount requests
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className={`cursor-pointer transition-colors ${tab === "pending" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/10" : ""}`}
          onClick={() => setTab("pending")}>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-600">{pending}</p>
            <p className="text-xs text-muted-foreground mt-1">Pending Approval</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${tab === "approved" ? "border-green-400 bg-green-50 dark:bg-green-950/10" : ""}`}
          onClick={() => setTab("approved")}>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600">
              {approvedData?.length ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Approved</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${tab === "rejected" ? "border-red-400 bg-red-50 dark:bg-red-950/10" : ""}`}
          onClick={() => setTab("rejected")}>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-red-600">
              {rejectedData?.length ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Rejected</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Pending
            {pending > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{pending}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />Approved
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" />Rejected
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardContent className="p-5"><div className="h-24 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            {tab === "pending"
              ? <><CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" /><p className="font-semibold">All clear!</p><p className="text-sm text-muted-foreground mt-1">No pending discount requests right now.</p></>
              : <><Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" /><p className="font-semibold capitalize">No {tab} requests</p><p className="text-sm text-muted-foreground mt-1">No discount requests have been {tab} yet.</p></>
            }
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <DiscountCard
              key={approval.id}
              approval={approval}
              isPending={resolveMutation.isPending}
              onApprove={approval.status === "pending" ? () => resolveMutation.mutate({ id: approval.id, status: "approved" }) : undefined}
              onReject={approval.status === "pending" ? () => resolveMutation.mutate({ id: approval.id, status: "rejected" }) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
