import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ReceiptView } from "@/components/receipt-view";
import { api } from "@/lib/api";

export default function ReceiptPrint() {
  const { receiptNumber } = useParams<{ receiptNumber: string }>();

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
      <div className="receipt-print-loading">
        Loading receipt...
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
    <div className="receipt-print-page">
      <div className="receipt-print-actions no-print">
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
