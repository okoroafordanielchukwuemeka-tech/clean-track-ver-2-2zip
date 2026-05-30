import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { api, type ReceiptListItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ReceiptView } from "@/components/receipt-view";
import { Receipt, Search, Eye, Printer, TrendingUp, DollarSign, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

function fmt(v: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

function methodBadge(method: string) {
  const map: Record<string, "default" | "success" | "info"> = { cash: "success", transfer: "info", pos: "default" };
  const labels: Record<string, string> = { cash: "Cash", transfer: "Transfer", pos: "POS" };
  return <Badge variant={map[method] ?? "outline"} className="text-xs">{labels[method] ?? method}</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, any> = { paid: "success", partial: "warning", unpaid: "destructive" };
  return <Badge variant={map[status] ?? "outline"} className="text-xs capitalize">{status}</Badge>;
}

type DateRange = "all" | "today" | "7days" | "30days" | "custom";

export default function Receipts() {
  const { isOwner } = useAuth();
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(0);
  const [selectedReceiptNumber, setSelectedReceiptNumber] = useState<string | null>(null);
  const limit = 50;

  const params: Record<string, string> = { limit: limit.toString(), offset: (page * limit).toString() };
  if (search) params.search = search;
  if (dateRange !== "all" && dateRange !== "custom") params.dateRange = dateRange;
  if (dateRange === "custom") {
    params.dateRange = "custom";
    if (customFrom) params.from = customFrom;
    if (customTo) params.to = customTo;
  }

  const { data, isLoading } = useQuery({
    queryKey: ["receipts", search, dateRange, customFrom, customTo, page],
    queryFn: () => api.receipts.list(params),
    enabled: isOwner,
  });

  const { data: receiptDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["receipt", selectedReceiptNumber],
    queryFn: () => api.receipts.getByNumber(selectedReceiptNumber!),
    enabled: !!selectedReceiptNumber,
  });

  if (!isOwner) {
    return <div className="p-8 text-center text-muted-foreground">Access denied</div>;
  }

  const receipts = data?.receipts ?? [];
  const total = data?.total ?? 0;
  const totalCollected = data?.totalCollected ?? 0;
  const totalBalance = data?.totalBalance ?? 0;
  const totalPages = Math.ceil(total / limit);

  const handlePrint = (receiptNumber: string) => {
    window.open(`/receipts/${encodeURIComponent(receiptNumber)}/print`, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          Receipts
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/40 rounded-lg">
              <Receipt className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Receipts</p>
              <p className="text-2xl font-bold">{total.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-950/40 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Collected</p>
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">{fmt(totalCollected)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-950/40 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-2xl font-bold text-red-600">{fmt(totalBalance)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search receipt #, customer name, phone, or order #…"
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              {(["all", "today", "7days", "30days", "custom"] as DateRange[]).map((r) => (
                <Button
                  key={r}
                  variant={dateRange === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setDateRange(r); setPage(0); }}
                >
                  {r === "all" ? "All" : r === "today" ? "Today" : r === "7days" ? "7 Days" : r === "30days" ? "30 Days" : "Custom"}
                </Button>
              ))}
              {dateRange === "custom" && (
                <div className="flex items-center gap-1 mt-1 sm:mt-0">
                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={customFrom}
                    onChange={(e) => { setCustomFrom(e.target.value); setPage(0); }}
                    placeholder="From"
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={customTo}
                    onChange={(e) => { setCustomTo(e.target.value); setPage(0); }}
                    placeholder="To"
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {total} receipt{total !== 1 ? "s" : ""}
            {search && ` matching "${search}"`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading receipts…</div>
          ) : receipts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? `No receipts match "${search}"` : "No receipts found for this period."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedReceiptNumber(r.receiptNumber)}>
                    <TableCell className="font-mono text-xs">{r.receiptNumber ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.orderRef}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{r.customerName}</div>
                      <div className="text-xs text-muted-foreground">{r.phone}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.recordedAt).toLocaleDateString("en-NG")}
                      <div className="text-xs">{new Date(r.recordedAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</div>
                    </TableCell>
                    <TableCell>{methodBadge(r.method)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(r.amount))}</TableCell>
                    <TableCell className="text-right">
                      {Number(r.remainingBalance) > 0
                        ? <span className="text-red-600 font-medium text-sm">{fmt(Number(r.remainingBalance))}</span>
                        : <span className="text-green-600 text-xs">Clear</span>}
                    </TableCell>
                    <TableCell>{statusBadge(r.paymentStatus)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title="View receipt" onClick={() => setSelectedReceiptNumber(r.receiptNumber)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {r.receiptNumber && (
                          <Button variant="ghost" size="icon" title="Print receipt" onClick={() => handlePrint(r.receiptNumber!)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages} · {total} total
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!selectedReceiptNumber} onOpenChange={(open) => { if (!open) setSelectedReceiptNumber(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {detailLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : receiptDetail ? (
            <div>
              <div className="flex items-center justify-between gap-2 p-4 border-b bg-muted/30">
                <p className="font-semibold">Receipt {receiptDetail.receipt?.receiptNumber}</p>
                <div className="flex gap-2">
                  {receiptDetail.receipt?.receiptNumber && (
                    <Button size="sm" variant="outline" onClick={() => handlePrint(receiptDetail.receipt!.receiptNumber!)}>
                      <Printer className="h-4 w-4 mr-1" />
                      Print / PDF
                    </Button>
                  )}
                </div>
              </div>
              <div className="p-4">
                <ReceiptView data={receiptDetail} showAllPayments />
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">Receipt not found</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
