import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type OrderInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Plus, Search, Eye } from "lucide-react";
import { toast } from "sonner";

function statusBadge(status: string) {
  const map: Record<string, any> = {
    pending: "warning",
    processing: "info",
    ready: "success",
  };
  return <Badge variant={map[status] || "outline"}>{status}</Badge>;
}

function paymentBadge(status: string) {
  const map: Record<string, any> = {
    unpaid: "destructive",
    partial: "warning",
    paid: "success",
  };
  return <Badge variant={map[status] || "outline"}>{status}</Badge>;
}

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

export default function Orders() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<Partial<OrderInput>>({
    serviceType: "standard",
    shirts: 0,
    trousers: 0,
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.orders.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: OrderInput) => api.orders.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowCreate(false);
      setForm({ serviceType: "standard", shirts: 0, trousers: 0 });
      toast.success("Order created successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderId.includes(search) ||
      o.phone.includes(search);
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchPayment = paymentFilter === "all" || o.paymentStatus === paymentFilter;
    return matchSearch && matchStatus && matchPayment;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          New Order
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, order ID, or phone..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filtered.length} order{filtered.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Shirts</TableHead>
                  <TableHead>Trousers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell>{order.phone}</TableCell>
                    <TableCell className="capitalize">{order.serviceType}</TableCell>
                    <TableCell>{order.shirts}</TableCell>
                    <TableCell>{order.trousers}</TableCell>
                    <TableCell>{statusBadge(order.status)}</TableCell>
                    <TableCell>{paymentBadge(order.paymentStatus)}</TableCell>
                    <TableCell>{formatCurrency(order.price as any)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild>
                        <Link to={`/orders/${order.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                      No orders found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Customer Name *</Label>
              <Input
                value={form.customerName ?? ""}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+234..."
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Service Type</Label>
              <Select
                value={form.serviceType ?? "standard"}
                onValueChange={(v) => setForm({ ...form, serviceType: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="express">Express</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Shirts</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.shirts ?? 0}
                  onChange={(e) => setForm({ ...form, shirts: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>Trousers</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.trousers ?? 0}
                  onChange={(e) => setForm({ ...form, trousers: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div>
              <Label>Price (₦)</Label>
              <Input
                type="number"
                min={0}
                value={form.price ?? ""}
                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || undefined })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Additional Notes</Label>
              <Input
                value={form.additionalNotes ?? ""}
                onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.customerName || !form.phone) {
                  toast.error("Name and phone are required");
                  return;
                }
                createMutation.mutate(form as OrderInput);
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
