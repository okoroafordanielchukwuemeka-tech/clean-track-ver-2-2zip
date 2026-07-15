import { Component, type ReactNode, type ErrorInfo } from "react";
import { WashingMachine, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CleanTrack] Unhandled error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-destructive/10 mb-6">
              <WashingMachine className="h-10 w-10 text-destructive/60" />
            </div>
            <p className="text-sm font-semibold text-destructive uppercase tracking-widest mb-2">
              Unexpected Error
            </p>
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Something went wrong
            </h1>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              An unexpected error occurred. This has been logged automatically.
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground/70 font-mono bg-muted rounded-md px-3 py-2 mb-6 text-left break-all">
                {this.state.error.message}
              </p>
            )}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button onClick={() => this.setState({ hasError: false, error: null })}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => { window.location.href = "/dashboard"; }}>
                <Home className="h-4 w-4 mr-2" />
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
