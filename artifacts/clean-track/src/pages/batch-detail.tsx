import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, Eye } from "lucide-react";
import { toast } from "sonner";

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const batchId = parseInt(id!);

  const { data: batch, isLoading } = useQuery({
    queryKey: ["batches", batchId],
    queryFn: () => api.batches.get(batchId),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.batches.update(batchId, { status: "completed" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches", batchId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Batch completed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!batch) return <div className="p-8 text-center text-muted-foreground">Batch not found</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/batches"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{batch.batchCode}</h1>
          <p className="text-sm text-muted-foreground">
            Created {new Date(batch.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={batch.status === "completed" ? "success" : "info"}>{batch.status}</Badge>
          {batch.status === "active" && (
            <Button
              size="sm"
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
            >
              <CheckCircle className="h-4 w-4" />
              Complete Batch
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold">{batch.orderCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Status</p>
            <p className="text-2xl font-bold capitalize">{batch.status}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Orders in Batch</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(batch.orders ?? []).map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell className="capitalize">{order.serviceType}</TableCell>
                  <TableCell>{order.shirts}S / {order.trousers}T</TableCell>
                  <TableCell>
                    <Badge variant={order.status === "ready" ? "success" : order.status === "processing" ? "info" : "warning"}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={order.paymentStatus === "paid" ? "success" : order.paymentStatus === "partial" ? "warning" : "destructive"}>
                      {order.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild>
                      <Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!batch.orders?.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No orders in this batch
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
