import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { idbPersister } from "@/lib/idb-persister";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { BranchProvider } from "@/context/branch-context";
import { AdminProvider, useAdmin } from "@/context/admin-context";
import AdminLogin from "@/pages/admin-login";
import AdminCommandCenter from "@/pages/admin-command-center";
import { ProtectedRoute } from "@/components/protected-route";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import Batches from "@/pages/batches";
import BatchDetail from "@/pages/batch-detail";
import Services from "@/pages/services";
import Workers from "@/pages/workers";
import Customers from "@/pages/customers";
import Expenditures from "@/pages/expenditures";
import SettingsPage from "@/pages/settings";
import WorkerStation from "@/pages/worker";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import WorkerLogin from "@/pages/worker-login";
import NotFound from "@/pages/not-found";
import DiscountApprovals from "@/pages/discount-approvals";
import Receipts from "@/pages/receipts";
import ReceiptPrint from "@/pages/receipt-print";
import BranchesPage from "@/pages/branches";
import DemoLogin from "@/pages/demo-login";
import OperationsPage from "@/pages/operations";

const STALE_TIME = 5 * 60 * 1000;       // 5 minutes
const GC_TIME   = 24 * 60 * 60 * 1000;  // 24 hours

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME,
      gcTime: GC_TIME,
      retry: 1,
    },
  },
});

/**
 * Phase 2: Wire up IndexedDB persistence at module scope.
 *
 * persistQueryClient is NOT a React hook — it is a plain function that
 * subscribes to queryClient cache changes and writes them to IndexedDB
 * via idbPersister. On the next page load, restoreClient() is called and
 * the cache is hydrated before any queries run.
 *
 * Using the low-level API (rather than PersistQueryClientProvider) avoids
 * the React strict-mode hook-validation edge case in the wrapper component.
 */
persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: GC_TIME,
  buster: "ct-v1",
});

function RootRedirect() {
  const { isOwner } = useAuth();
  return <Navigate to={isOwner ? "/dashboard" : "/worker-station"} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BranchProvider>
          <AdminProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/worker-login" element={<WorkerLogin />} />
              <Route path="/demo-access" element={<DemoLogin />} />

              {/* CleanTrack Admin Portal — internal only */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminCommandCenter />} />

              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<RootRedirect />} />
                <Route path="dashboard" element={<ProtectedRoute ownerOnly><Dashboard /></ProtectedRoute>} />
                <Route path="orders" element={<Orders />} />
                <Route path="orders/:id" element={<OrderDetail />} />
                <Route path="batches" element={<ProtectedRoute ownerOnly><Batches /></ProtectedRoute>} />
                <Route path="batches/:id" element={<ProtectedRoute ownerOnly><BatchDetail /></ProtectedRoute>} />
                <Route path="services" element={<ProtectedRoute ownerOnly><Services /></ProtectedRoute>} />
                <Route path="workers" element={<ProtectedRoute ownerOnly><Workers /></ProtectedRoute>} />
                <Route path="branches" element={<ProtectedRoute ownerOnly><BranchesPage /></ProtectedRoute>} />
                <Route path="customers" element={<Customers />} />
                <Route path="discount-approvals" element={<ProtectedRoute ownerOnly><DiscountApprovals /></ProtectedRoute>} />
                <Route path="expenditures" element={<ProtectedRoute ownerOnly><Expenditures /></ProtectedRoute>} />
                <Route path="receipts" element={<ProtectedRoute ownerOnly><Receipts /></ProtectedRoute>} />
                <Route path="settings" element={<ProtectedRoute ownerOnly><SettingsPage /></ProtectedRoute>} />
                <Route path="operations" element={<ProtectedRoute ownerOnly><OperationsPage /></ProtectedRoute>} />
                <Route path="worker-station" element={<WorkerStation />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="/receipts/:receiptNumber/print" element={<ReceiptPrint />} />
            </Routes>
          </BrowserRouter>
          <Toaster richColors />
          </AdminProvider>
        </BranchProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
