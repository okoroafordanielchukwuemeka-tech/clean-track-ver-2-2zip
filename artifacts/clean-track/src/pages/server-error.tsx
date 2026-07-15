import { Button } from "@/components/ui/button";
import { WashingMachine, RefreshCw, Home } from "lucide-react";
import { Link } from "react-router-dom";

export default function ServerError({ message }: { message?: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-destructive/10 mb-6">
          <WashingMachine className="h-10 w-10 text-destructive/60" />
        </div>

        {/* Error code */}
        <p className="text-sm font-semibold text-destructive uppercase tracking-widest mb-2">500 — Server Error</p>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-foreground mb-3">
          Something went wrong
        </h1>

        {/* Description */}
        <p className="text-muted-foreground mb-2 leading-relaxed">
          We ran into an unexpected error on our end. This has been logged and our
          team will look into it.
        </p>
        {message && (
          <p className="text-xs text-muted-foreground/70 font-mono bg-muted rounded-md px-3 py-2 mb-6 text-left break-all">
            {message}
          </p>
        )}
        {!message && <div className="mb-6" />}

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">
              <Home className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
