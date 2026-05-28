import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/auth-context";
import { CheckCircle, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

function statusBadge(status: string) {
  const map: Record<string, any> = { pending: "warning", processing: "info", ready: "success" };
  return <Badge variant={map[status] || "outline"}>{status}</Badge>;
}

export default function WorkerStation() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.orders.list(),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, any> }) => api.orders.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const myOrders = orders.filter((o) => o.assignedWorkerId === user?.id);
  const sharedQueue = orders.filter((o) => o.status === "pending" && !o.assignedWorkerId);
  const verifyQueue = orders.filter((o) => o.status === "processing" && !o.isVerified);
  const readyOrders = orders.filter((o) => o.status === "ready");

  const markVerified = (id: number, o: any) => {
    updateMutation.mutate({
      id,
      data: { isVerified: true, verifiedShirts: o.shirts, verifiedTrousers: o.trousers },
    });
  };

  const markReady = (id: number) => {
    updateMutation.mutate({ id, data: { status: "ready" } });
  };

  const claimOrder = (id: number) => {
    updateMutation.mutate({ id, data: { assignedWorkerId: user?.id, status: "processing" } });
  };

  const OrderTable = ({ items, showActions = true }: { items: typeof orders; showActions?: boolean }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order ID</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Status</TableHead>
          {showActions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((order) => (
          <TableRow key={order.id}>
            <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
            <TableCell className="font-medium">{order.customerName}</TableCell>
            <TableCell className="capitalize">{order.serviceType}</TableCell>
            <TableCell>{order.shirts}S / {order.trousers}T</TableCell>
            <TableCell>{statusBadge(order.status)}</TableCell>
            {showActions && (
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" asChild>
                    <Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                  </Button>
                  {order.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => claimOrder(order.id)}>
                      Claim
                    </Button>
                  )}
                  {order.status === "processing" && !order.isVerified && (
                    <Button size="sm" variant="outline" onClick={() => markVerified(order.id, order)}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Verify
                    </Button>
                  )}
                  {order.status === "processing" && order.isVerified && (
                    <Button size="sm" onClick={() => markReady(order.id)}>
                      Mark Ready
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
        {!items.length && (
          <TableRow>
            <TableCell colSpan={showActions ? 6 : 5} className="text-center py-8 text-muted-foreground">
              No orders in this queue
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Worker Station</h1>
        <p className="text-sm text-muted-foreground">
          Logged in as <strong>{user?.name}</strong>
          {user?.role && <span className="ml-1 capitalize">({user.role})</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{myOrders.length}</p>
            <p className="text-xs text-muted-foreground">My Orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{sharedQueue.length}</p>
            <p className="text-xs text-muted-foreground">Shared Queue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{verifyQueue.length}</p>
            <p className="text-xs text-muted-foreground">Needs Verification</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{readyOrders.length}</p>
            <p className="text-xs text-muted-foreground">Ready</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="my-orders">
        <TabsList>
          <TabsTrigger value="my-orders">My Orders ({myOrders.length})</TabsTrigger>
          <TabsTrigger value="shared">Shared Queue ({sharedQueue.length})</TabsTrigger>
          <TabsTrigger value="verify">Verify ({verifyQueue.length})</TabsTrigger>
          <TabsTrigger value="ready">Ready ({readyOrders.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="my-orders">
          <Card><CardContent className="p-0"><OrderTable items={myOrders} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="shared">
          <Card><CardContent className="p-0"><OrderTable items={sharedQueue} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="verify">
          <Card><CardContent className="p-0"><OrderTable items={verifyQueue} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="ready">
          <Card><CardContent className="p-0"><OrderTable items={readyOrders} showActions={false} /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
