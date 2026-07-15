import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";

/**
 * Paystack redirects the browser here after checkout (?reference=... or
 * ?trxref=...). We verify server-side as a fallback in case the webhook
 * hasn't landed yet — activation itself is idempotent either way.
 */
export default function BillingCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<"verifying" | "success" | "failed" | "error">("verifying");
  const [message, setMessage] = useState("Confirming your payment…");

  useEffect(() => {
    const reference = searchParams.get("reference") ?? searchParams.get("trxref");
    if (!reference) {
      setState("error");
      setMessage("No payment reference found.");
      return;
    }

    let attempts = 0;
    async function poll() {
      attempts++;
      try {
        const result = await api.subscription.verifyPayment(reference!);
        if (result.status === "success") {
          setState("success");
          setMessage("Payment confirmed — your plan is now active.");
          return;
        }
        if (result.status === "failed" || result.status === "abandoned") {
          setState("failed");
          setMessage("This payment did not complete. You can retry from the Billing tab.");
          return;
        }
        // pending / processing — retry a few times in case the webhook is still landing
        if (attempts < 5) {
          setTimeout(poll, 2000);
        } else {
          setState("error");
          setMessage("Still confirming your payment. Check the Billing tab in a moment.");
        }
      } catch {
        if (attempts < 3) {
          setTimeout(poll, 2000);
        } else {
          setState("error");
          setMessage("Couldn't confirm your payment. Check the Billing tab or contact support.");
        }
      }
    }
    poll();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="max-w-sm w-full text-center space-y-4 rounded-xl border bg-background p-8 shadow-sm">
        {state === "verifying" && <RefreshCw className="h-10 w-10 mx-auto animate-spin text-muted-foreground" />}
        {state === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500" />}
        {(state === "failed" || state === "error") && <XCircle className="h-10 w-10 mx-auto text-red-500" />}
        <h1 className="text-lg font-semibold">
          {state === "verifying" && "Confirming payment"}
          {state === "success" && "Payment successful"}
          {state === "failed" && "Payment not completed"}
          {state === "error" && "Almost there"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {state !== "verifying" && (
          <Button className="w-full" onClick={() => navigate("/settings?tab=billing")}>
            Go to Billing
          </Button>
        )}
      </div>
    </div>
  );
}
