import { Badge } from "@/components/ui/badge";

export interface ReceiptData {
  receipt: {
    receiptNumber: string | null;
    recordedAt: string;
    amount: number;
    method: string;
    notes?: string | null;
    remainingBalance: number;
    recordedBy?: string | null;
    cashierName?: string | null;
  } | null;
  laundry: {
    businessName: string;
    phone: string;
    address: string;
    email: string;
    logoUrl: string;
    receiptHeaderName: string;
    receiptFooterText: string;
    brandColor: string;
  };
  branch?: {
    id: number;
    name: string;
    address?: string;
  } | null;
  customer: {
    fullName: string;
    phone: string;
    address: string;
  };
  order: {
    id: number;
    orderId: string;
    serviceType: string;
    shirts: number;
    trousers: number;
    status: string;
    paymentStatus: string;
    additionalNotes?: string | null;
    createdAt: string;
  };
  items: {
    id: number;
    name: string;
    quantity: number;
    unitPrice: number | string;
    totalPrice: number | string;
    serviceType: string;
  }[];
  priceAdjustments: {
    id: number;
    type: "discount" | "extra_charge";
    amount: string;
    reason: string;
    appliedBy: string;
    createdAt: string;
  }[];
  pricing: {
    basePrice: number;
    extraCharge: number;
    discount: number;
    totalDue: number;
    amountPaid: number;
    balance: number;
  };
  allPayments: {
    id: number;
    receiptNumber: string | null;
    amount: number;
    method: string;
    recordedBy?: string | null;
    recordedAt: string;
    remainingBalance: number;
  }[];
}

function fmt(v: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

function methodLabel(m: string) {
  const map: Record<string, string> = { cash: "Cash", transfer: "Bank Transfer", pos: "POS / Card" };
  return map[m] ?? m;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") return <span className="receipt-status-paid">✓ PAID IN FULL</span>;
  if (status === "partial") return <span className="receipt-status-partial">PARTIAL PAYMENT</span>;
  return <span className="receipt-status-unpaid">UNPAID</span>;
}

interface ReceiptViewProps {
  data: ReceiptData;
  showAllPayments?: boolean;
}

export function ReceiptView({ data, showAllPayments = true }: ReceiptViewProps) {
  const { receipt, laundry, branch, customer, order, items, priceAdjustments, pricing, allPayments } = data;
  const isItemBased = items && items.length > 0;
  const headerName = laundry.receiptHeaderName || laundry.businessName;

  return (
    <div className="receipt-root">
      <div className="receipt-header">
        {laundry.logoUrl && (
          <img src={laundry.logoUrl} alt={headerName} className="receipt-logo" />
        )}
        <h1 className="receipt-business-name">{headerName}</h1>
        {branch && <p className="receipt-contact" style={{ fontWeight: 600 }}>{branch.name}</p>}
        {laundry.address && <p className="receipt-contact">{laundry.address}</p>}
        {branch?.address && branch.address !== laundry.address && <p className="receipt-contact">{branch.address}</p>}
        {laundry.phone && <p className="receipt-contact">{laundry.phone}</p>}
        {laundry.email && <p className="receipt-contact">{laundry.email}</p>}
      </div>

      <div className="receipt-divider" />

      <div className="receipt-meta-row">
        <div>
          <p className="receipt-label">RECEIPT</p>
          <p className="receipt-value-mono">{receipt?.receiptNumber ?? "—"}</p>
        </div>
        <div className="receipt-meta-right">
          <p className="receipt-label">DATE</p>
          <p className="receipt-value">{receipt ? new Date(receipt.recordedAt).toLocaleString("en-NG") : new Date(order.createdAt).toLocaleString("en-NG")}</p>
        </div>
      </div>

      <div className="receipt-meta-row">
        <div>
          <p className="receipt-label">ORDER #</p>
          <p className="receipt-value-mono">{order.orderId}</p>
        </div>
        <div className="receipt-meta-right">
          <p className="receipt-label">SERVICE</p>
          <p className="receipt-value" style={{ textTransform: "capitalize" }}>{order.serviceType}</p>
        </div>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-section">
        <p className="receipt-section-title">CUSTOMER</p>
        <p className="receipt-value">{customer.fullName}</p>
        <p className="receipt-contact">{customer.phone}</p>
        {customer.address && <p className="receipt-contact">{customer.address}</p>}
      </div>

      {receipt && (
        <div className="receipt-section">
          <p className="receipt-section-title">PAYMENT</p>
          <div className="receipt-row">
            <span>Method</span>
            <span className="receipt-value">{methodLabel(receipt.method)}</span>
          </div>
          {(receipt.cashierName || receipt.recordedBy) && (
            <div className="receipt-row">
              <span>Received by</span>
              <span className="receipt-value">{receipt.cashierName || receipt.recordedBy}</span>
            </div>
          )}
          {receipt.notes && (
            <div className="receipt-row">
              <span>Notes</span>
              <span className="receipt-value">{receipt.notes}</span>
            </div>
          )}
        </div>
      )}

      <div className="receipt-divider" />

      <div className="receipt-section">
        <p className="receipt-section-title">ORDER ITEMS</p>
        {isItemBased ? (
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="receipt-th">Item</th>
                <th className="receipt-th receipt-th-right">Qty</th>
                <th className="receipt-th receipt-th-right">Unit</th>
                <th className="receipt-th receipt-th-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="receipt-td">{item.name}</td>
                  <td className="receipt-td receipt-td-right">{item.quantity}</td>
                  <td className="receipt-td receipt-td-right">{fmt(Number(item.unitPrice))}</td>
                  <td className="receipt-td receipt-td-right">{fmt(Number(item.totalPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="receipt-th">Item</th>
                <th className="receipt-th receipt-th-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {order.shirts > 0 && (
                <tr>
                  <td className="receipt-td">Shirts</td>
                  <td className="receipt-td receipt-td-right">{order.shirts}</td>
                </tr>
              )}
              {order.trousers > 0 && (
                <tr>
                  <td className="receipt-td">Trousers</td>
                  <td className="receipt-td receipt-td-right">{order.trousers}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="receipt-divider" />

      <div className="receipt-section">
        <div className="receipt-row">
          <span>Subtotal</span>
          <span>{fmt(pricing.basePrice)}</span>
        </div>
        {pricing.extraCharge > 0 && (
          <div className="receipt-row">
            <span>
              Extra Charge
              {priceAdjustments.filter(a => a.type === "extra_charge").map(a => (
                <span key={a.id} className="receipt-adj-reason"> — {a.reason}</span>
              ))}
            </span>
            <span className="receipt-surcharge">+{fmt(pricing.extraCharge)}</span>
          </div>
        )}
        {pricing.discount > 0 && (
          <div className="receipt-row">
            <span>
              Discount
              {priceAdjustments.filter(a => a.type === "discount").map(a => (
                <span key={a.id} className="receipt-adj-reason"> — {a.reason}</span>
              ))}
            </span>
            <span className="receipt-discount">−{fmt(pricing.discount)}</span>
          </div>
        )}
        <div className="receipt-divider-thin" />
        <div className="receipt-row receipt-total-row">
          <span>TOTAL DUE</span>
          <span>{fmt(pricing.totalDue)}</span>
        </div>
        <div className="receipt-row">
          <span>Amount Paid</span>
          <span className="receipt-paid">{fmt(pricing.amountPaid)}</span>
        </div>
        {pricing.balance > 0 && (
          <div className="receipt-row receipt-balance-row">
            <span>Balance Due</span>
            <span>{fmt(pricing.balance)}</span>
          </div>
        )}
      </div>

      <div className="receipt-status-row">
        <StatusBadge status={order.paymentStatus} />
      </div>

      {showAllPayments && allPayments.length > 1 && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-section">
            <p className="receipt-section-title">PAYMENT HISTORY</p>
            <table className="receipt-table">
              <thead>
                <tr>
                  <th className="receipt-th">Receipt #</th>
                  <th className="receipt-th">Date</th>
                  <th className="receipt-th">Method</th>
                  <th className="receipt-th receipt-th-right">Amount</th>
                  <th className="receipt-th receipt-th-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {allPayments.map((p) => (
                  <tr key={p.id} className={p.receiptNumber === receipt?.receiptNumber ? "receipt-row-current" : ""}>
                    <td className="receipt-td receipt-mono">{p.receiptNumber ?? "—"}</td>
                    <td className="receipt-td">{new Date(p.recordedAt).toLocaleDateString("en-NG")}</td>
                    <td className="receipt-td">{methodLabel(p.method)}</td>
                    <td className="receipt-td receipt-td-right">{fmt(p.amount)}</td>
                    <td className="receipt-td receipt-td-right">{fmt(p.remainingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {order.additionalNotes && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-section">
            <p className="receipt-section-title">NOTES</p>
            <p className="receipt-contact">{order.additionalNotes}</p>
          </div>
        </>
      )}

      {laundry.receiptFooterText && (
        <>
          <div className="receipt-divider" />
          <p className="receipt-footer">{laundry.receiptFooterText}</p>
        </>
      )}

      <p className="receipt-generated">Generated by Clean Track · {new Date().toLocaleDateString("en-NG")}</p>
    </div>
  );
}
