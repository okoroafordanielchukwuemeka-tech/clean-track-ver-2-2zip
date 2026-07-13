import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BatchInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
import { Plus, Eye, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/branch-context";

export default function Batches() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: () => api.batches.list(),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders", "pending", activeBranchId],
    queryFn: () => api.orders.list({ status: "pending", ...(activeBranchId ? { branchId: String(activeBranchId) } : {}) }),
  });

  const createMutation = useMutation({
    mutationFn: (data: BatchInput) => api.batches.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowCreate(false);
      setSelectedOrders([]);
      toast.success("Batch created successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => api.batches.update(id, { status: "completed" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Batch marked as completed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingOrders = orders.filter((o) => o.status === "pending");

  const toggleOrder = (id: number) => {
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Batches</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Batch
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{batches.length} batch{batches.length !== 1 ? "es" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-4 w-24 bg-muted animate-pulse rounded font-mono" />
                  <div className="h-5 w-16 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-12 bg-muted animate-pulse rounded ml-4" />
                  <div className="h-4 w-20 bg-muted animate-pulse rounded ml-auto" />
                  <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-mono font-medium">{batch.batchCode}</TableCell>
                    <TableCell>
                      <Badge variant={batch.status === "completed" ? "success" : "info"}>
                        {batch.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{batch.orderCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" asChild>
                          <Link to={`/batches/${batch.id}`}><Eye className="h-4 w-4" /></Link>
                        </Button>
                        {batch.status === "active" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => completeMutation.mutate(batch.id)}
                            title="Mark as completed"
                          >
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!batches.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      No batches yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select pending orders to include in this batch:
            </p>
            {pendingOrders.length === 0 ? (
              <p className="text-center py-4 text-muted-foreground text-sm">No pending orders available</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {pendingOrders.map((order) => (
                  <label
                    key={order.id}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      onChange={() => toggleOrder(order.id)}
                      className="rounded"
                    />
                    <div className="flex-1 text-sm">
                      <span className="font-medium">{order.customerName}</span>
                      <span className="text-muted-foreground ml-2">{order.orderId}</span>
                    </div>
                    <span className="text-xs text-muted-foreground capitalize">{order.serviceType}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-sm font-medium">
              Selected: {selectedOrders.length} order{selectedOrders.length !== 1 ? "s" : ""}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (selectedOrders.length === 0) {
                  toast.error("Select at least one order");
                  return;
                }
                createMutation.mutate({ orderIds: selectedOrders });
              }}
              disabled={createMutation.isPending || selectedOrders.length === 0}
            >
              {createMutation.isPending ? "Creating..." : "Create Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
