import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WashingMachine, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted mb-6">
          <WashingMachine className="h-10 w-10 text-muted-foreground/50" />
        </div>

        {/* Error code */}
        <p className="text-sm font-semibold text-primary uppercase tracking-widest mb-2">404 — Page Not Found</p>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-foreground mb-3">
          This page doesn't exist
        </h1>

        {/* Description */}
        <p className="text-muted-foreground mb-8 leading-relaxed">
          The page you're looking for may have been moved, deleted, or the link
          might be incorrect. Head back to the dashboard to continue.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button asChild>
            <Link to="/dashboard">
              <Home className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Link>
          </Button>
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    </div>
  );
}
