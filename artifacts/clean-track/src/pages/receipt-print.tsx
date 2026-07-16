import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ReceiptView } from "@/components/receipt-view";
import { api } from "@/lib/api";

type PrintFormat = "80mm" | "58mm" | "a4";

export default function ReceiptPrint() {
  const { receiptNumber } = useParams<{ receiptNumber: string }>();
  const [format, setFormat] = useState<PrintFormat>("80mm");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["receipt", receiptNumber],
    queryFn: () => api.receipts.getByNumber(receiptNumber!),
    enabled: !!receiptNumber,
  });

  useEffect(() => {
    if (data) {
      document.title = `Receipt ${data.receipt?.receiptNumber ?? receiptNumber}`;
    }
  }, [data, receiptNumber]);

  if (isLoading) {
    return (
      <div className="receipt-print-loading" aria-live="polite" aria-busy="true">
        <div style={{ textAlign: "center", padding: "2rem", color: "#888", fontSize: "0.875rem" }}>
          Preparing receipt…
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="receipt-print-loading">
        Receipt not found.
      </div>
    );
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
      <ReceiptView data={data} showAllPayments />
    </div>
  );
}
