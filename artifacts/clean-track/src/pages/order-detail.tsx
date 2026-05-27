import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type PaymentInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Trash2, Plus, CheckCircle } from "lucide-react";
import { toast } from "sonner";

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));
}

function statusBadge(s: string) {
  const map: Record<string, any> = { pending: "warning", processing: "info", ready: "success" };
  return <Badge variant={map[s] || "outline"}>{s}</Badge>;
}

function paymentBadge(s: string) {
  const map: Record<string, any> = { unpaid: "destructive", partial: "warning", paid: "success" };
  return <Badge variant={map[s] || "outline"}>{s}</Badge>;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentInput>({ amount: 0, method: "cash" });
  const [verifyForm, setVerifyForm] = useState({ verifiedShirts: 0, verifiedTrousers: 0 });
  const [updateForm, setUpdateForm] = useState<Record<string, any>>({});

  const orderId = parseInt(id!);

  const { data: order, isLoading } = useQuery({
    queryKey: ["orders", orderId],
    queryFn: () => api.orders.get(orderId),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["orders", orderId, "payments"],
    queryFn: () => api.orders.payments(orderId),
    enabled: !!orderId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => api.orders.update(orderId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.orders.delete(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      navigate("/orders");
      toast.success("Order deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paymentMutation = useMutation({
    mutationFn: (data: PaymentInput) => api.orders.recordPayment(orderId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders", orderId, "payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowPayment(false);
      setPaymentForm({ amount: 0, method: "cash" });
      toast.success("Payment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (pid: number) => api.orders.deletePayment(orderId, pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId, "payments"] });
      toast.success("Payment deleted");
    },
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">Order not found</div>;

  const totalDue = (Number(order.price) || 0) + (Number(order.extraCharge) || 0) - (Number(order.discount) || 0);
  const amountPaid = Number(order.amountPaid) || 0;
  const balance = totalDue - amountPaid;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/orders"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Order {order.orderId}</h1>
          <p className="text-sm text-muted-foreground">
            Created {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {statusBadge(order.status)}
          {paymentBadge(order.paymentStatus)}
          {order.isVerified && (
            <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Customer Information</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{order.customerName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{order.phone}</span></div>
            {order.address && <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span>{order.address}</span></div>}
            {order.additionalNotes && <div className="flex justify-between"><span className="text-muted-foreground">Notes</span><span>{order.additionalNotes}</span></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Order Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Service Type</span><span className="capitalize font-medium">{order.serviceType}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Shirts</span><span>{order.shirts}{order.verifiedShirts != null ? ` (verified: ${order.verifiedShirts})` : ""}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Trousers</span><span>{order.trousers}{order.verifiedTrousers != null ? ` (verified: ${order.verifiedTrousers})` : ""}</span></div>
            {order.batchId && <div className="flex justify-between"><span className="text-muted-foreground">Batch ID</span><Link to={`/batches/${order.batchId}`} className="text-primary hover:underline">{order.batchId}</Link></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Pricing</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Base Price</span><span>{formatCurrency(order.price as any)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Extra Charge</span><span>{formatCurrency(order.extraCharge as any)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>{formatCurrency(order.discount as any)}</span></div>
            <div className="flex justify-between font-medium border-t pt-2 mt-2"><span>Total Due</span><span>{formatCurrency(totalDue)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="text-green-600">{formatCurrency(amountPaid)}</span></div>
            <div className="flex justify-between font-medium"><span>Balance</span><span className={balance > 0 ? "text-red-600" : "text-green-600"}>{formatCurrency(balance)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Update Order</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select
                value={order.status}
                onValueChange={(v) => updateMutation.mutate({ status: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Price (₦)</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    defaultValue={order.price as any}
                    onChange={(e) => setUpdateForm({ ...updateForm, price: parseFloat(e.target.value) })}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Extra Charge (₦)</Label>
                <Input
                  type="number"
                  defaultValue={order.extraCharge as any}
                  onChange={(e) => setUpdateForm({ ...updateForm, extraCharge: parseFloat(e.target.value) })}
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Discount (₦)</Label>
              <Input
                type="number"
                defaultValue={order.discount as any}
                onChange={(e) => setUpdateForm({ ...updateForm, discount: parseFloat(e.target.value) })}
                placeholder="0"
              />
            </div>
            {Object.keys(updateForm).length > 0 && (
              <Button
                size="sm"
                onClick={() => { updateMutation.mutate(updateForm); setUpdateForm({}); }}
                disabled={updateMutation.isPending}
              >
                Save Changes
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payment History</CardTitle>
          <Button size="sm" onClick={() => setShowPayment(true)}>
            <Plus className="h-4 w-4" /> Record Payment
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Balance After</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{formatCurrency(Number(p.amount))}</TableCell>
                  <TableCell className="capitalize">{p.method}</TableCell>
                  <TableCell>{formatCurrency(Number(p.remainingBalance))}</TableCell>
                  <TableCell>{p.notes || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.recordedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deletePaymentMutation.mutate(p.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!payments.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                    No payments recorded
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          variant="destructive"
          onClick={() => setShowDelete(true)}
        >
          <Trash2 className="h-4 w-4" /> Delete Order
        </Button>
      </div>

      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (₦) *</Label>
              <Input
                type="number"
                min={0}
                value={paymentForm.amount || ""}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })}
                placeholder="Enter amount"
              />
            </div>
            <div>
              <Label>Method</Label>
              <Select
                value={paymentForm.method}
                onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v as any })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={paymentForm.notes ?? ""}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!paymentForm.amount || paymentForm.amount <= 0) {
                  toast.error("Enter a valid amount");
                  return;
                }
                paymentMutation.mutate(paymentForm);
              }}
              disabled={paymentMutation.isPending}
            >
              {paymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Order</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete order <strong>{order.orderId}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
