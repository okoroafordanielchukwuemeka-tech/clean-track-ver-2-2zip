import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
  ownerOnly?: boolean;
}

const WORKER_ALLOWED_PREFIXES = [
  "/worker-station",
  "/orders",
  "/customers",
  "/receipts",
  "/batches",
  "/customer-hub",
];

export function ProtectedRoute({ children, ownerOnly = false }: ProtectedRouteProps) {
  const { isAuthenticated, isOwner, isWorker } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (ownerOnly && !isOwner) {
    return <Navigate to="/worker-station" replace />;
  }

  if (isWorker) {
    const allowed = WORKER_ALLOWED_PREFIXES.some(
      (prefix) =>
        location.pathname === prefix ||
        location.pathname.startsWith(prefix + "/")
    );
    if (!allowed) {
      return <Navigate to="/worker-station" replace />;
    }
  }

  return <>{children}</>;
}
