import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import Batches from "@/pages/batches";
import BatchDetail from "@/pages/batch-detail";
import Services from "@/pages/services";
import Workers from "@/pages/workers";
import WorkerStation from "@/pages/worker";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import WorkerLogin from "@/pages/worker-login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/worker-login" element={<WorkerLogin />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<ProtectedRoute ownerOnly><Dashboard /></ProtectedRoute>} />
              <Route path="orders" element={<ProtectedRoute ownerOnly><Orders /></ProtectedRoute>} />
              <Route path="orders/:id" element={<ProtectedRoute ownerOnly><OrderDetail /></ProtectedRoute>} />
              <Route path="batches" element={<ProtectedRoute ownerOnly><Batches /></ProtectedRoute>} />
              <Route path="batches/:id" element={<ProtectedRoute ownerOnly><BatchDetail /></ProtectedRoute>} />
              <Route path="services" element={<ProtectedRoute ownerOnly><Services /></ProtectedRoute>} />
              <Route path="workers" element={<ProtectedRoute ownerOnly><Workers /></ProtectedRoute>} />
              <Route path="worker-station" element={<WorkerStation />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
