import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type PaymentInput, type PickupInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Trash2, Plus, CheckCircle, ShoppingBag, Package } from "lucide-react";
import { toast } from "sonner";

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));
}

function statusBadge(s: string) {
  const map: Record<string, any> = {
    pending: "warning",
    processing: "info",
    ready: "success",
    partial_pickup: "warning",
    completed: "success",
  };
  const label: Record<string, string> = {
    partial_pickup: "Partial Pickup",
    completed: "Completed",
  };
  return <Badge variant={map[s] || "outline"}>{label[s] ?? s}</Badge>;
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
  const [showPickup, setShowPickup] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentInput>({ amount: 0, method: "cash" });
  const [pickupForm, setPickupForm] = useState<PickupInput>({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
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

  const { data: pickups = [] } = useQuery({
    queryKey: ["orders", orderId, "pickups"],
    queryFn: () => api.pickups.list(orderId),
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
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      toast.success("Payment deleted");
    },
  });

  const pickupMutation = useMutation({
    mutationFn: (data: PickupInput) => api.pickups.record(orderId, data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders", orderId, "pickups"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowPickup(false);
      setPickupForm({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
      if (res.order.allPickedUp && res.order.fullyPaid) {
        toast.success("Order completed — all items picked up and fully paid!");
      } else if (res.order.allPickedUp) {
        toast.success("All items picked up! Outstanding balance remains.");
      } else {
        toast.success(`Pickup recorded — ${res.order.remainingShirts}S / ${res.order.remainingTrousers}T remaining`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">Order not found</div>;

  const totalDue = (Number(order.price) || 0) + (Number(order.extraCharge) || 0) - (Number(order.discount) || 0);
  const amountPaid = Number(order.amountPaid) || 0;
  const balance = totalDue - amountPaid;

  const shirtsPickedUp = order.shirtsPickedUp ?? 0;
  const trousersPickedUp = order.trousersPickedUp ?? 0;
  const remainingShirts = Math.max(0, order.shirts - shirtsPickedUp);
  const remainingTrousers = Math.max(0, order.trousers - trousersPickedUp);
  const hasRemaining = remainingShirts > 0 || remainingTrousers > 0;
  const canRecordPickup = (order.status === "ready" || order.status === "partial_pickup") && hasRemaining;

  const maxShirtsToPickUp = remainingShirts;
  const maxTrousersToPickUp = remainingTrousers;

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
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {statusBadge(order.status)}
          {paymentBadge(order.paymentStatus)}
          {order.isVerified && (
            <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>
          )}
          {canRecordPickup && (
            <Button size="sm" onClick={() => setShowPickup(true)}>
              <ShoppingBag className="h-4 w-4" />
              Record Pickup
            </Button>
          )}
        </div>
      </div>

      {(order.status === "partial_pickup" || order.status === "completed" || shirtsPickedUp > 0 || trousersPickedUp > 0) && (
        <Card className={order.status === "completed" ? "border-green-200 bg-green-50/50 dark:bg-green-950/10" : "border-orange-200 bg-orange-50/50 dark:bg-orange-950/10"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Package className={`h-4 w-4 ${order.status === "completed" ? "text-green-600" : "text-orange-600"}`} />
              <span className="font-semibold text-sm">
                {order.status === "completed" ? "All Items Picked Up" : "Pickup Progress"}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="text-center p-2 bg-background rounded-lg border">
                <p className="text-2xl font-bold">{order.shirts}</p>
                <p className="text-xs text-muted-foreground">Shirts Received</p>
              </div>
              <div className="text-center p-2 bg-background rounded-lg border">
                <p className="text-2xl font-bold text-green-600">{shirtsPickedUp}</p>
                <p className="text-xs text-muted-foreground">Shirts Picked Up</p>
              </div>
              <div className="text-center p-2 bg-background rounded-lg border">
                <p className="text-2xl font-bold">{order.trousers}</p>
                <p className="text-xs text-muted-foreground">Trousers Received</p>
              </div>
              <div className="text-center p-2 bg-background rounded-lg border">
                <p className="text-2xl font-bold text-green-600">{trousersPickedUp}</p>
                <p className="text-xs text-muted-foreground">Trousers Picked Up</p>
              </div>
            </div>
            {hasRemaining && (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Still remaining:</span>
                {remainingShirts > 0 && (
                  <Badge variant="warning">{remainingShirts} shirt{remainingShirts !== 1 ? "s" : ""}</Badge>
                )}
                {remainingTrousers > 0 && (
                  <Badge variant="warning">{remainingTrousers} trouser{remainingTrousers !== 1 ? "s" : ""}</Badge>
                )}
                {balance > 0 && (
                  <Badge variant="destructive">Balance: {formatCurrency(balance)}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shirts</span>
              <span>{order.shirts}{shirtsPickedUp > 0 ? ` (${shirtsPickedUp} picked up, ${remainingShirts} remaining)` : ""}
              {order.verifiedShirts != null ? ` — verified: ${order.verifiedShirts}` : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trousers</span>
              <span>{order.trousers}{trousersPickedUp > 0 ? ` (${trousersPickedUp} picked up, ${remainingTrousers} remaining)` : ""}
              {order.verifiedTrousers != null ? ` — verified: ${order.verifiedTrousers}` : ""}</span>
            </div>
            {order.batchId && <div className="flex justify-between"><span className="text-muted-foreground">Batch ID</span><Link to={`/batches/${order.batchId}`} className="text-primary hover:underline">{order.batchId}</Link></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Pricing & Balance</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Base Price</span><span>{formatCurrency(order.price as any)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Extra Charge</span><span>{formatCurrency(order.extraCharge as any)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>{formatCurrency(order.discount as any)}</span></div>
            <div className="flex justify-between font-medium border-t pt-2 mt-2"><span>Total Due</span><span>{formatCurrency(totalDue)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="text-green-600">{formatCurrency(amountPaid)}</span></div>
            <div className="flex justify-between font-semibold">
              <span>Outstanding Balance</span>
              <span className={balance > 0 ? "text-red-600" : "text-green-600"}>
                {balance > 0 ? formatCurrency(balance) : "Fully Paid"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Update Order</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={order.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="partial_pickup">Partial Pickup</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Price (₦)</Label>
                <Input
                  type="number"
                  defaultValue={order.price as any}
                  onChange={(e) => setUpdateForm({ ...updateForm, price: parseFloat(e.target.value) })}
                  placeholder="0"
                />
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

      {pickups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              Pickup History ({pickups.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shirts</TableHead>
                  <TableHead>Trousers</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Date & Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pickups.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.shirtsPickedUp} shirt{p.shirtsPickedUp !== 1 ? "s" : ""}</TableCell>
                    <TableCell>{p.trousersPickedUp} trouser{p.trousersPickedUp !== 1 ? "s" : ""}</TableCell>
                    <TableCell className="text-muted-foreground">{p.notes || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleString("en-NG", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                    <Button variant="ghost" size="icon" onClick={() => deletePaymentMutation.mutate(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!payments.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No payments recorded</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="destructive" onClick={() => setShowDelete(true)}>
          <Trash2 className="h-4 w-4" /> Delete Order
        </Button>
      </div>

      <Dialog open={showPickup} onOpenChange={setShowPickup}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" /> Record Pickup
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Shirts remaining</p>
                <p className="font-semibold text-lg">{remainingShirts}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Trousers remaining</p>
                <p className="font-semibold text-lg">{remainingTrousers}</p>
              </div>
              {balance > 0 && (
                <div className="col-span-2 border-t pt-2">
                  <p className="text-muted-foreground text-xs mb-1">Outstanding balance</p>
                  <p className="font-semibold text-red-600">{formatCurrency(balance)}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Shirts picking up</Label>
                <Input
                  type="number"
                  min={0}
                  max={maxShirtsToPickUp}
                  value={pickupForm.shirtsPickedUp}
                  onChange={(e) => setPickupForm({ ...pickupForm, shirtsPickedUp: Math.min(parseInt(e.target.value) || 0, maxShirtsToPickUp) })}
                />
                <p className="text-xs text-muted-foreground mt-1">Max: {maxShirtsToPickUp}</p>
              </div>
              <div>
                <Label>Trousers picking up</Label>
                <Input
                  type="number"
                  min={0}
                  max={maxTrousersToPickUp}
                  value={pickupForm.trousersPickedUp}
                  onChange={(e) => setPickupForm({ ...pickupForm, trousersPickedUp: Math.min(parseInt(e.target.value) || 0, maxTrousersToPickUp) })}
                />
                <p className="text-xs text-muted-foreground mt-1">Max: {maxTrousersToPickUp}</p>
              </div>
            </div>

            <div>
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={pickupForm.notes ?? ""}
                onChange={(e) => setPickupForm({ ...pickupForm, notes: e.target.value })}
                placeholder="e.g. customer collected 3 shirts only"
              />
            </div>

            {(pickupForm.shirtsPickedUp > 0 || pickupForm.trousersPickedUp > 0) && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm border border-blue-200 dark:border-blue-800">
                <p className="font-medium text-blue-700 dark:text-blue-400 mb-1">After this pickup:</p>
                <p className="text-blue-600 dark:text-blue-300">
                  {Math.max(0, remainingShirts - pickupForm.shirtsPickedUp)}S / {Math.max(0, remainingTrousers - pickupForm.trousersPickedUp)}T remaining
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPickup(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (pickupForm.shirtsPickedUp === 0 && pickupForm.trousersPickedUp === 0) {
                  toast.error("Enter at least one item to pick up");
                  return;
                }
                pickupMutation.mutate(pickupForm);
              }}
              disabled={pickupMutation.isPending}
            >
              {pickupMutation.isPending ? "Recording..." : "Confirm Pickup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {balance > 0 && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <span className="text-muted-foreground">Outstanding balance: </span>
                <span className="font-semibold text-red-600">{formatCurrency(balance)}</span>
              </div>
            )}
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
              <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v as any })}>
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
                if (!paymentForm.amount || paymentForm.amount <= 0) { toast.error("Enter a valid amount"); return; }
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
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
