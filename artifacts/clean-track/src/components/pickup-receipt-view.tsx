export interface PickupReceiptData {
  pickup: {
    id: number;
    pickupNumber: string;
    createdAt: string;
    notes?: string | null;
    recordedBy?: string | null;
  };
  laundry: {
    businessName: string;
    phone: string;
    address: string;
    email: string;
    logoUrl: string;
    receiptHeaderName: string;
    receiptFooterText: string;
    brandColor: string;
    paymentDetails?: {
      preferredMethod?: string;
      bankName?: string;
      accountName?: string;
      accountNumber?: string;
      instructions?: string;
    } | null;
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
    status: string;
    paymentStatus: string;
  };
  itemsCollected: { name: string; quantity: number }[];
  itemsRemaining: { name: string; quantity: number }[];
  pricing: {
    basePrice: number;
    extraCharge: number;
    discount: number;
    totalDue: number;
    amountPaid: number;
    balance: number;
    isCancelled?: boolean;
  };
}

function fmt(v: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

interface PickupReceiptViewProps {
  data: PickupReceiptData;
}

export function PickupReceiptView({ data }: PickupReceiptViewProps) {
  const { pickup, laundry, branch, customer, order, itemsCollected, itemsRemaining, pricing } = data;
  const headerName = laundry.receiptHeaderName || laundry.businessName;
  const isFullyCollected = itemsRemaining.length === 0;

  return (
    <div className="receipt-root">
      <div className="receipt-header">
        {laundry.logoUrl ? (
          <img src={laundry.logoUrl} alt={headerName} className="receipt-logo" />
        ) : (
          <div className="receipt-logo-placeholder" aria-hidden="true">
            {headerName.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "B"}
          </div>
        )}
        <h1 className="receipt-business-name">{headerName}</h1>
        {branch && <p className="receipt-contact receipt-branch-name">{branch.name}</p>}
        {laundry.address && <p className="receipt-contact">{laundry.address}</p>}
        {laundry.phone && <p className="receipt-contact">{laundry.phone}</p>}
        {laundry.email && <p className="receipt-contact">{laundry.email}</p>}
      </div>

      <div className="receipt-divider" />

      <p className="receipt-doc-title">PICKUP RECEIPT</p>

      <div className="receipt-meta-row">
        <div>
          <p className="receipt-label">PICKUP #</p>
          <p className="receipt-value-mono">{pickup.pickupNumber}</p>
        </div>
        <div className="receipt-meta-right">
          <p className="receipt-label">DATE</p>
          <p className="receipt-value">{new Date(pickup.createdAt).toLocaleString("en-NG")}</p>
        </div>
      </div>

      <div className="receipt-meta-row">
        <div>
          <p className="receipt-label">ORDER #</p>
          <p className="receipt-value-mono">{order.orderId}</p>
        </div>
        <div className="receipt-meta-right">
          <p className="receipt-label">STAFF</p>
          <p className="receipt-value">{pickup.recordedBy ?? "—"}</p>
        </div>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-section">
        <p className="receipt-section-title">CUSTOMER</p>
        <p className="receipt-value">{customer.fullName}</p>
        <p className="receipt-contact">{customer.phone}</p>
      </div>

      <div className="receipt-divider" />

      <div className="receipt-section">
        <p className="receipt-section-title">ITEMS COLLECTED TODAY</p>
        <table className="receipt-table">
          <thead>
            <tr>
              <th className="receipt-th">Item</th>
              <th className="receipt-th receipt-th-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {itemsCollected.length === 0 ? (
              <tr><td className="receipt-td" colSpan={2}>—</td></tr>
            ) : itemsCollected.map((it, i) => (
              <tr key={i}>
                <td className="receipt-td">{it.name}</td>
                <td className="receipt-td receipt-td-right">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="receipt-section">
        <p className="receipt-section-title">ITEMS REMAINING WITH US</p>
        {itemsRemaining.length === 0 ? (
          <p className="receipt-value" style={{ color: "#27ae60" }}>None — all items collected</p>
        ) : (
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="receipt-th">Item</th>
                <th className="receipt-th receipt-th-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {itemsRemaining.map((it, i) => (
                <tr key={i}>
                  <td className="receipt-td">{it.name}</td>
                  <td className="receipt-td receipt-td-right">{it.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="receipt-divider" />

      <div className="receipt-section">
        <div className="receipt-row">
          <span>Order Total</span>
          <span>{fmt(pricing.totalDue)}</span>
        </div>
        <div className="receipt-row">
          <span>Amount Paid</span>
          <span className="receipt-paid">{fmt(pricing.amountPaid)}</span>
        </div>
        {pricing.balance > 0 ? (
          <div className="receipt-row receipt-balance-row">
            <span>Outstanding Balance</span>
            <span>{fmt(pricing.balance)}</span>
          </div>
        ) : (
          <div className="receipt-row">
            <span>Outstanding Balance</span>
            <span className="receipt-paid">Fully Paid</span>
          </div>
        )}
      </div>

      <div className="receipt-status-row">
        <span className={isFullyCollected ? "receipt-status-paid" : "receipt-status-partial"}>
          {isFullyCollected ? "✓ ALL ITEMS COLLECTED" : "PARTIAL COLLECTION"}
        </span>
      </div>
      {order.status === "cancelled" && (
        <div className="receipt-status-row">
          <span className="receipt-status-unpaid">✕ ORDER SINCE CANCELLED</span>
        </div>
      )}

      {pricing.balance > 0 && laundry.paymentDetails?.instructions && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-section">
            <p className="receipt-section-title">HOW TO PAY THE BALANCE</p>
            <p className="receipt-contact">{laundry.paymentDetails.instructions}</p>
            <div className="receipt-row"><span>Reference</span><span className="receipt-value-mono">{order.orderId}</span></div>
          </div>
        </>
      )}

      {pickup.notes && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-section">
            <p className="receipt-section-title">NOTES</p>
            <p className="receipt-contact">{pickup.notes}</p>
          </div>
        </>
      )}

      <div className="receipt-divider" />

      <div className="receipt-ack-section">
        <p className="receipt-section-title">CUSTOMER ACKNOWLEDGEMENT</p>
        <p className="receipt-contact">I confirm I have received the item(s) listed above in good condition.</p>
        <div className="receipt-ack-line">
          <span>Signature</span>
          <span>Date</span>
        </div>
      </div>

      <div className="receipt-barcode">
        <div className="receipt-barcode-bars" aria-hidden="true">
          {pickup.pickupNumber.split("").map((ch, i) => (
            <span key={i} style={{ height: 14 + ((ch.charCodeAt(0) * (i + 1)) % 20) }} />
          ))}
        </div>
        <p className="receipt-mono" style={{ textAlign: "center" }}>{pickup.pickupNumber}</p>
      </div>

      {laundry.receiptFooterText && (
        <>
          <div className="receipt-divider" />
          <p className="receipt-footer">{laundry.receiptFooterText}</p>
        </>
      )}

      <p className="receipt-generated">Generated by CleanTrack · {new Date().toLocaleDateString("en-NG")}</p>
    </div>
  );
}
