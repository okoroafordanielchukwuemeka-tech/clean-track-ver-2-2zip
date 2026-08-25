import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ReceiptView } from "@/components/receipt-view";
import { api } from "@/lib/api";

type PrintFormat = "80mm" | "58mm" | "a4";

export default function ReceiptPrint() {
  const { receiptNumber } = useParams<{ receiptNumber: string }>();
  const [format, setFormat] = useState<PrintFormat>("80mm");
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "shared">("idle");

  // Inject a dynamic @page rule whenever the format changes.
  // CSS @page cannot be scoped to a class, so we swap a <style> tag.
  useEffect(() => {
    const id = "receipt-page-style";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    if (format === "a4") {
      el.textContent = "@page { size: A4 portrait; margin: 12mm; }";
    } else if (format === "58mm") {
      el.textContent = "@page { size: 58mm auto; margin: 2mm; }";
    } else {
      el.textContent = "@page { size: 80mm auto; margin: 2mm; }";
    }
    return () => { /* leave style in place; updated on next render */ };
  }, [format]);

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

  const handlePrint = () => window.print();

  const handleShare = async () => {
    const url = window.location.href;
    const title = `Receipt ${data?.receipt?.receiptNumber ?? receiptNumber}`;
    const text = `${data?.laundry?.businessName ?? "Receipt"} — ${data?.customer?.fullName ?? ""}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        setShareStatus("shared");
        setTimeout(() => setShareStatus("idle"), 2000);
      } catch {
        // user cancelled or share failed — fall back to clipboard
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2500);
    } catch {
      // clipboard not available — prompt user
      window.prompt("Copy this receipt link:", text);
    }
  };

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
    return <div className="receipt-print-loading">Receipt not found.</div>;
  }

  return (
    <div className={`receipt-print-page print-format-${format}`}>
      <div className="receipt-print-actions no-print">
        {/* Format selector */}
        <div className="receipt-print-formats">
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
        </div>

        {/* Action buttons */}
        <div className="receipt-print-actions-row">
          <button onClick={handlePrint} className="receipt-print-btn receipt-print-btn-primary">
            🖨 Print / PDF
          </button>
          <button
            onClick={handleShare}
            className="receipt-print-btn"
            title="Share or copy link"
          >
            {shareStatus === "copied"
              ? "✓ Link copied"
              : shareStatus === "shared"
              ? "✓ Shared"
              : "↗ Share"}
          </button>
          <button
            onClick={handlePrint}
            className="receipt-print-btn"
            title="Save as PDF via print dialog"
          >
            ⬇ Download PDF
          </button>
          <button
            onClick={() => window.close()}
            className="receipt-print-btn receipt-print-btn-secondary"
          >
            Close
          </button>
        </div>
      </div>

      <ReceiptView data={data} showAllPayments />
    </div>
  );
}
