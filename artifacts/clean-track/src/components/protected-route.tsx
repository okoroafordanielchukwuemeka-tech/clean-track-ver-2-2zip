import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
  ownerOnly?: boolean;
}

export function ProtectedRoute({ children, ownerOnly = false }: ProtectedRouteProps) {
  const { isAuthenticated, isOwner, isWorker } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (ownerOnly && !isOwner) {
    return <Navigate to="/worker-station" replace />;
  }

  if (isWorker && location.pathname !== "/worker-station") {
    return <Navigate to="/worker-station" replace />;
  }

  return <>{children}</>;
}
