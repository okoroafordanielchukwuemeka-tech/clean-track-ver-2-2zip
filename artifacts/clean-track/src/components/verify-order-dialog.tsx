import { useEffect, useState } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type VerificationItem = { id: number; name: string; quantity: number; };
type VerificationOrder = { orderId: string; customerName: string; shirts: number; trousers: number; items?: VerificationItem[]; };

export function VerifyOrderDialog({ order, open, onOpenChange, onConfirm, isPending }: {
  order: VerificationOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: { verificationDetails?: Record<string, number>; verifiedShirts?: number; verifiedTrousers?: number; isVerified: true }) => void;
  isPending?: boolean;
}) {
  const [legacy, setLegacy] = useState({ shirts: 0, trousers: 0 });
  const [items, setItems] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!order || !open) return;
    setLegacy({ shirts: order.shirts ?? 0, trousers: order.trousers ?? 0 });
    setItems(Object.fromEntries((order.items ?? []).map(item => [String(item.id), item.quantity])));
  }, [order, open]);
  if (!order) return null;
  const itemBased = (order.items?.length ?? 0) > 0;
  const confirm = () => itemBased
    ? onConfirm({ verificationDetails: items, isVerified: true })
    : onConfirm({ verifiedShirts: Math.max(0, legacy.shirts), verifiedTrousers: Math.max(0, legacy.trousers), isVerified: true });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Verify clothes received</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Count the physical clothes for this order. These values become the order's verification record before processing.</p>
        <div className="space-y-3 py-2">
          {itemBased ? order.items!.map(item => (
            <div key={item.id} className="grid grid-cols-[1fr_110px] items-center gap-3">
              <div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">Pickup recorded: {item.quantity}</p></div>
              <Input type="number" min={0} value={items[String(item.id)] ?? 0} onChange={e => setItems(v => ({ ...v, [String(item.id)]: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
          )) : (
            <>
              <div className="grid grid-cols-[1fr_110px] items-center gap-3"><div><p className="text-sm font-medium">Shirts</p><p className="text-xs text-muted-foreground">Pickup recorded: {order.shirts}</p></div><Input type="number" min={0} value={legacy.shirts} onChange={e => setLegacy(v => ({ ...v, shirts: Math.max(0, Number(e.target.value) || 0) }))} /></div>
              <div className="grid grid-cols-[1fr_110px] items-center gap-3"><div><p className="text-sm font-medium">Trousers</p><p className="text-xs text-muted-foreground">Pickup recorded: {order.trousers}</p></div><Input type="number" min={0} value={legacy.trousers} onChange={e => setLegacy(v => ({ ...v, trousers: Math.max(0, Number(e.target.value) || 0) }))} /></div>
            </>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button><Button onClick={confirm} disabled={isPending} className="gap-2"><CheckCircle className="h-4 w-4" />{isPending ? "Saving..." : "Verify & Accept"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
