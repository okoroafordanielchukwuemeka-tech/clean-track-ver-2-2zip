import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { RoleProvider } from "@/context/role-context";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import Batches from "@/pages/batches";
import BatchDetail from "@/pages/batch-detail";
import Services from "@/pages/services";
import Workers from "@/pages/workers";
import WorkerStation from "@/pages/worker";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RoleProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="orders" element={<Orders />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="batches" element={<Batches />} />
              <Route path="batches/:id" element={<BatchDetail />} />
              <Route path="services" element={<Services />} />
              <Route path="workers" element={<Workers />} />
              <Route path="worker-station" element={<WorkerStation />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors />
      </RoleProvider>
    </QueryClientProvider>
  );
}
