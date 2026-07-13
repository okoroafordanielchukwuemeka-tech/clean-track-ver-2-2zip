import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PickupReceiptView } from "@/components/pickup-receipt-view";
import { api } from "@/lib/api";

type PrintFormat = "80mm" | "58mm" | "a4";

export default function PickupReceiptPrint() {
  const { orderId, pickupId } = useParams<{ orderId: string; pickupId: string }>();
  const [format, setFormat] = useState<PrintFormat>("80mm");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pickup-receipt", orderId, pickupId],
    queryFn: () => api.pickups.getReceipt(parseInt(orderId!), parseInt(pickupId!)),
    enabled: !!orderId && !!pickupId,
  });

  useEffect(() => {
    if (data) {
      document.title = `Pickup Receipt ${data.pickup.pickupNumber}`;
    }
  }, [data]);

  if (isLoading) {
    return <div className="receipt-print-loading">Loading pickup receipt...</div>;
  }

  if (isError || !data) {
    return <div className="receipt-print-loading">Pickup receipt not found.</div>;
  }

  return (
    <div className={`receipt-print-page print-format-${format}`}>
      <div className="receipt-print-actions no-print">
        {(["58mm", "80mm", "a4"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className="receipt-print-btn"
            style={format === f ? { background: "#111", color: "#fff" } : undefined}
          >
            {f === "a4" ? "A4" : f}
          </button>
        ))}
        <button onClick={() => window.print()} className="receipt-print-btn">
          🖨 Print / Save as PDF
        </button>
        <button onClick={() => window.close()} className="receipt-print-btn receipt-print-btn-secondary">
          Close
        </button>
      </div>
      <PickupReceiptView data={data} />
    </div>
  );
}
