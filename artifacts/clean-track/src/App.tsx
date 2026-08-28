import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/context/theme-context";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { idbPersister } from "@/lib/idb-persister";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { BranchProvider } from "@/context/branch-context";
import { AdminProvider, useAdmin } from "@/context/admin-context";
import { ProtectedRoute } from "@/components/protected-route";
import { ErrorBoundary } from "@/components/error-boundary";

// ── Lazily-loaded pages ────────────────────────────────────────────────────
// Every route is loaded on demand so the initial login shell does not pull in
// the authenticated workspace, charts, admin console, or print views.
const Login           = lazy(() => import("@/pages/login"));
const Signup          = lazy(() => import("@/pages/signup"));
const WorkerLogin     = lazy(() => import("@/pages/worker-login"));
const WorkerStation   = lazy(() => import("@/pages/worker"));
const NotFound         = lazy(() => import("@/pages/not-found"));
const Dashboard        = lazy(() => import("@/pages/dashboard"));
const Orders           = lazy(() => import("@/pages/orders"));
const OrderDetail      = lazy(() => import("@/pages/order-detail"));
const Batches          = lazy(() => import("@/pages/batches"));
const BatchDetail      = lazy(() => import("@/pages/batch-detail"));
const Services         = lazy(() => import("@/pages/services"));
const Workers          = lazy(() => import("@/pages/workers"));
const Customers        = lazy(() => import("@/pages/customers"));
const Expenditures     = lazy(() => import("@/pages/expenditures"));
const SettingsPage     = lazy(() => import("@/pages/settings"));
const DiscountApprovals = lazy(() => import("@/pages/discount-approvals"));
const Receipts         = lazy(() => import("@/pages/receipts"));
const BranchesPage     = lazy(() => import("@/pages/branches"));
const OperationsPage   = lazy(() => import("@/pages/operations"));
const CustomerHubPage  = lazy(() => import("@/pages/customer-hub"));
const PlatformHealthPage = lazy(() => import("@/pages/platform-health"));
const MarketingPage    = lazy(() => import("@/pages/marketing"));
const AdminLogin       = lazy(() => import("@/pages/admin-login"));
const AdminCommandCenter = lazy(() => import("@/pages/admin-command-center"));
const ForgotPassword   = lazy(() => import("@/pages/forgot-password"));
const ResetPassword    = lazy(() => import("@/pages/reset-password"));
const DemoLogin        = lazy(() => import("@/pages/demo-login"));
const BillingCallback  = lazy(() => import("@/pages/billing-callback"));
const ReceiptPrint     = lazy(() => import("@/pages/receipt-print"));
const PickupReceiptPrint = lazy(() => import("@/pages/pickup-receipt-print"));
const Welcome          = lazy(() => import("@/pages/welcome"));
const Pricing          = lazy(() => import("@/pages/pricing"));
const AppLayout        = lazy(() => import("@/components/layout").then(({ Layout }) => ({ default: Layout })));

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
  // Bumping this buster invalidates ALL previously persisted IndexedDB
  // cache entries for every user on next load — use this whenever a cached
  // response shape (or its correctness) may have gone stale, e.g. the
  // WhatsApp Meta config once-cached-false-forever bug (2026-07-01).
  buster: "ct-v2",
});

function RootRedirect() {
  const { isOwner } = useAuth();
  return <Navigate to={isOwner ? "/dashboard" : "/worker-station"} replace />;
}

function RouteLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading CleanTrack…
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <AuthProvider>
        <BranchProvider>
          <AdminProvider>
          <BrowserRouter>
            <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/worker-login" element={<WorkerLogin />} />
              <Route path="/demo-access" element={<DemoLogin />} />
              <Route path="/demo-login" element={<DemoLogin />} />

              {/* CleanTrack Admin Portal — internal only */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminCommandCenter />} />

              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout />
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
                <Route path="customer-hub" element={<ProtectedRoute ownerOnly><CustomerHubPage /></ProtectedRoute>} />
                <Route path="platform-health" element={<ProtectedRoute ownerOnly><PlatformHealthPage /></ProtectedRoute>} />
                <Route path="marketing" element={<ProtectedRoute ownerOnly><MarketingPage /></ProtectedRoute>} />
                <Route path="worker-station" element={<WorkerStation />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="/billing/callback" element={<BillingCallback />} />
              <Route path="/receipts/:receiptNumber/print" element={<ReceiptPrint />} />
              <Route path="/orders/:orderId/pickups/:pickupId/print" element={<PickupReceiptPrint />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster richColors />
          </AdminProvider>
        </BranchProvider>
      </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
