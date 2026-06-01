import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Order, type Service, type CustomerWithMetrics, type SlaSettings } from "@/lib/api";
import { useBranch } from "@/context/branch-context";
import { useAuth } from "@/context/auth-context";
import { localDb, type LocalOrder, type LocalOrderItem } from "@/lib/local-db";
import { enqueueOrderCreate } from "@/lib/queue-service";
import { getIsOnline } from "@/lib/network-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Check, Search, User, Clock,
  Package, Tag, FileText, Plus, Minus, X, AlertTriangle,
} from "lucide-react";

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STEPS = ["Customer", "Service", "Items", "Adjustments", "Review"];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

function getUnitPrice(svc: Service, serviceType: "standard" | "express" | "premium"): number {
  if (serviceType === "express") return Number(svc.expressPrice ?? svc.standardPrice);
  if (serviceType === "premium") return Number(svc.premiumPrice ?? svc.standardPrice);
  return Number(svc.standardPrice);
}

function groupByCategory(services: Service[]): Record<string, Service[]> {
  return services.filter(s => s.isActive).reduce((acc, s) => {
    const cat = s.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {} as Record<string, Service[]>);
}

export function CreateOrderDialog({ open, onOpenChange, onSuccess }: CreateOrderDialogProps) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { laundryId } = useAuth();
  const [step, setStep] = useState(0);

  const [customerSearch, setCustomerSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithMetrics | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [serviceType, setServiceType] = useState<"standard" | "express" | "premium">("standard");
  const [serviceSearch, setServiceSearch] = useState("");

  const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [extraCharge, setExtraCharge] = useState(0);
  const [extraChargeReason, setExtraChargeReason] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(customerSearch), 350);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const { data: customerResults = [] } = useQuery({
    queryKey: ["customers", "search", debouncedSearch],
    queryFn: () => api.customers.list({ search: debouncedSearch }),
    enabled: debouncedSearch.length >= 2 && !selectedCustomer,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services"],
    queryFn: () => api.services.list(),
    enabled: open,
  });

  const { data: sla } = useQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
    enabled: open,
  });

  const createMutation = useMutation<Order | null, Error, void>({
    mutationFn: async () => {
      const itemsArray = Array.from(selectedItems.entries())
        .filter(([, qty]) => qty > 0)
        .map(([serviceId, quantity]) => ({ serviceId, quantity }));

      if (!getIsOnline()) {
        if (!laundryId) {
          throw new Error("Session data is missing. Please reload and try again.");
        }

        const localId = crypto.randomUUID();
        const now = new Date().toISOString();

        const localItems: LocalOrderItem[] = itemsArray.map(({ serviceId, quantity }) => {
          const svc = services.find(s => s.id === serviceId);
          const unitPrice = svc ? getUnitPrice(svc, serviceType) : 0;
          return {
            localId: crypto.randomUUID(),
            orderLocalId: localId,
            orderId: null,
            serviceId,
            serviceType,
            name: svc?.name ?? `Service #${serviceId}`,
            quantity,
            quantityPickedUp: 0,
            unitPrice,
            totalPrice: unitPrice * quantity,
            syncStatus: "pending" as const,
          };
        });

        // Determine whether this order is for an offline-created customer.
        // When no server customer is selected and a phone number is present,
        // look up a matching pending_create customer in the local DB.
        // If found, populate customerLocalId and dependsOn so Phase 3B syncs
        // the customer before this order.
        let resolvedCustomerLocalId: string | null = null;
        let dependsOn: string[] = [];

        if (!selectedCustomer && effectivePhone.trim()) {
          const localCustomer = await localDb.customers
            .where("phone")
            .equals(effectivePhone.trim())
            .filter(
              c =>
                c.syncStatus === "pending_create" &&
                c.laundryId === laundryId
            )
            .first();
          if (localCustomer) {
            resolvedCustomerLocalId = localCustomer.localId;
            dependsOn = [localCustomer.localId];
          }
        }

        const localOrder: LocalOrder = {
          localId,
          serverId: null,
          laundryId: laundryId,
          branchId: activeBranchId,
          customerLocalId: resolvedCustomerLocalId,
          customerId: selectedCustomer?.id ?? null,
          orderId: `OFL-${localId.slice(0, 8).toUpperCase()}`,
          customerName: effectiveName,
          phone: effectivePhone,
          address: effectiveAddress || null,
          serviceType,
          status: "pending",
          paymentStatus: "unpaid",
          price: totalDue,
          extraCharge: extraCharge > 0 ? extraCharge : null,
          discount: discount > 0 ? discount : null,
          amountPaid: 0,
          additionalNotes: additionalNotes || null,
          syncStatus: "pending_create",
          createdAt: now,
          updatedAt: now,
        };

        await enqueueOrderCreate(
          localId,
          localOrder,
          localItems,
          {
            customerName: effectiveName,
            phone: effectivePhone,
            address: effectiveAddress || null,
            customerId: selectedCustomer?.id ?? null,
            customerLocalId: resolvedCustomerLocalId,
            serviceType,
            items: itemsArray,
            additionalNotes: additionalNotes || null,
            discount: discount > 0 ? discount : null,
            discountReason: discount > 0 ? discountReason : null,
            extraCharge: extraCharge > 0 ? extraCharge : null,
            extraChargeReason: extraCharge > 0 ? extraChargeReason : null,
            branchId: activeBranchId,
            laundryId,
          },
          dependsOn
        );
        return null;
      }

      return api.orders.create({
        customerName: selectedCustomer ? selectedCustomer.fullName : customerName,
        phone: selectedCustomer ? selectedCustomer.phone : phone,
        address: selectedCustomer
          ? (selectedCustomer.address ?? (address || undefined))
          : (address || undefined),
        customerId: selectedCustomer?.id,
        serviceType,
        items: itemsArray.length > 0 ? itemsArray : undefined,
        additionalNotes: additionalNotes || undefined,
        discount: discount > 0 ? discount : undefined,
        discountReason: discount > 0 ? discountReason : undefined,
        extraCharge: extraCharge > 0 ? extraCharge : undefined,
        extraChargeReason: extraCharge > 0 ? extraChargeReason : undefined,
        branchId: activeBranchId ?? undefined,
      });
    },
    onSuccess: (result) => {
      if (result === null) {
        toast.info("Saved offline. Will sync automatically when connection returns.");
      } else {
        qc.invalidateQueries({ queryKey: ["orders"] });
        toast.success("Order created successfully");
      }
      handleClose();
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleClose() {
    onOpenChange(false);
    setTimeout(resetForm, 300);
  }

  function resetForm() {
    setStep(0);
    setCustomerSearch("");
    setDebouncedSearch("");
    setSelectedCustomer(null);
    setCustomerName("");
    setPhone("");
    setAddress("");
    setServiceType("standard");
    setServiceSearch("");
    setSelectedItems(new Map());
    setAdditionalNotes("");
    setDiscount(0);
    setDiscountReason("");
    setExtraCharge(0);
    setExtraChargeReason("");
    setShowDropdown(false);
  }

  function selectCustomer(c: CustomerWithMetrics) {
    setSelectedCustomer(c);
    setCustomerSearch(c.fullName);
    setShowDropdown(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCustomerName("");
    setPhone("");
    setAddress("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function setItemQty(serviceId: number, qty: number) {
    const map = new Map(selectedItems);
    if (qty <= 0) map.delete(serviceId);
    else map.set(serviceId, qty);
    setSelectedItems(map);
  }

  const servicesByCategory = groupByCategory(services);

  const subtotal = Array.from(selectedItems.entries()).reduce((sum, [serviceId, qty]) => {
    if (qty === 0) return sum;
    const svc = services.find(s => s.id === serviceId);
    if (!svc) return sum;
    return sum + getUnitPrice(svc, serviceType) * qty;
  }, 0);
  const totalDue = subtotal + extraCharge - discount;
  const itemCount = Array.from(selectedItems.values()).reduce((s, q) => s + q, 0);

  const readyByHours = sla
    ? (serviceType === "express" ? sla.expressTurnaroundHours
      : serviceType === "premium" ? sla.premiumTurnaroundHours
      : sla.standardTurnaroundHours)
    : null;
  const readyBy = readyByHours ? new Date(Date.now() + readyByHours * 3600000) : null;

  const effectiveName = selectedCustomer ? selectedCustomer.fullName : customerName;
  const effectivePhone = selectedCustomer ? selectedCustomer.phone : phone;
  const effectiveAddress = selectedCustomer ? (selectedCustomer.address ?? address) : address;

  function validateAndNext() {
    if (step === 0) {
      if (!effectiveName.trim()) { toast.error("Customer name is required"); return; }
      if (!effectivePhone.trim()) { toast.error("Phone number is required"); return; }
    }
    if (step === 2 && itemCount === 0) {
      toast.error("Select at least one item"); return;
    }
    if (step === 3) {
      if (discount > 0 && !discountReason.trim()) { toast.error("Discount reason is required"); return; }
      if (extraCharge > 0 && !extraChargeReason.trim()) { toast.error("Extra charge reason is required"); return; }
    }
    if (step === STEPS.length - 1) {
      createMutation.mutate();
      return;
    }
    setStep(s => s + 1);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>New Order</DialogTitle>
          <div className="flex items-center gap-1 mt-3">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                    i < step ? "bg-primary text-primary-foreground cursor-pointer hover:opacity-80" :
                    i === step ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1" :
                    "bg-muted text-muted-foreground cursor-default"
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn("h-0.5 w-6 mx-0.5 transition-colors", i < step ? "bg-primary" : "bg-muted")} />
                )}
              </div>
            ))}
            <span className="ml-3 text-sm text-muted-foreground font-medium">{STEPS[step]}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Search Existing Customer</Label>
                <div className="relative mt-1.5">
                  {selectedCustomer ? (
                    <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{selectedCustomer.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedCustomer.phone}
                          {selectedCustomer.totalOrders > 0 && ` · ${selectedCustomer.totalOrders} order${selectedCustomer.totalOrders !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={clearCustomer}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={searchRef}
                        className="pl-9"
                        placeholder="Search by name or phone..."
                        value={customerSearch}
                        onChange={(e) => { setCustomerSearch(e.target.value); setShowDropdown(true); }}
                        onFocus={() => setShowDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                      />
                      {showDropdown && customerResults.length > 0 && (
                        <div className="absolute z-50 top-full mt-1 left-0 right-0 border rounded-lg bg-popover shadow-lg max-h-52 overflow-y-auto">
                          {customerResults.slice(0, 6).map(c => (
                            <button
                              key={c.id}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted transition-colors border-b last:border-0"
                              onMouseDown={() => selectCustomer(c)}
                            >
                              <User className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{c.fullName}</p>
                                <p className="text-xs text-muted-foreground">{c.phone} · {c.totalOrders} orders</p>
                              </div>
                              {c.outstandingBalance > 0 && (
                                <Badge variant="warning" className="text-xs shrink-0">
                                  {formatCurrency(c.outstandingBalance)} owed
                                </Badge>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {!selectedCustomer && (
                <>
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground px-1">or enter new customer</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label>Full Name <span className="text-destructive">*</span></Label>
                      <Input
                        className="mt-1"
                        placeholder="Customer full name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Phone <span className="text-destructive">*</span></Label>
                      <Input
                        className="mt-1"
                        placeholder="+234..."
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Address <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                      <Input
                        className="mt-1"
                        placeholder="Home or delivery address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {selectedCustomer != null && (selectedCustomer.outstandingBalance ?? 0) > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-800 dark:text-amber-400">Outstanding Balance</p>
                    <p className="text-amber-700 dark:text-amber-500 text-xs mt-0.5">
                      This customer owes {formatCurrency(selectedCustomer.outstandingBalance ?? 0)} from previous orders.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Choose the service tier for this order.</p>
              {(["standard", "express", "premium"] as const).map(type => {
                const hours = sla
                  ? (type === "express" ? sla.expressTurnaroundHours
                    : type === "premium" ? sla.premiumTurnaroundHours
                    : sla.standardTurnaroundHours)
                  : null;
                const dueDate = hours ? new Date(Date.now() + hours * 3600000) : null;
                const isSelected = serviceType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setServiceType(type)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border-2 transition-all",
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40 bg-background"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "border-primary" : "border-muted-foreground/30"
                        )}>
                          {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </div>
                        <div>
                          <p className="font-semibold capitalize">{type}</p>
                          {hours && dueDate && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {hours}h · Ready by {dueDate.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={type === "express" ? "warning" : type === "premium" ? "info" : "outline"}
                        className="capitalize shrink-0"
                      >
                        {type}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Select items and quantities.</p>
                {itemCount > 0 && (
                  <Badge variant="outline" className="font-semibold text-sm">
                    {itemCount} item{itemCount !== 1 ? "s" : ""} · {formatCurrency(subtotal)}
                  </Badge>
                )}
              </div>

              {services.filter(s => s.isActive).length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-9"
                    placeholder="Search services…"
                    value={serviceSearch}
                    onChange={e => setServiceSearch(e.target.value)}
                    autoComplete="off"
                  />
                  {serviceSearch && (
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setServiceSearch("")}
                      tabIndex={-1}
                      type="button"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {(() => {
                const activeServices = services.filter(s => s.isActive);
                if (activeServices.length === 0) {
                  return (
                    <div className="py-10 text-center text-muted-foreground text-sm border rounded-xl">
                      No active services. Add services in the Services catalogue first.
                    </div>
                  );
                }

                const serviceRow = (svc: Service) => {
                  const qty = selectedItems.get(svc.id) ?? 0;
                  const unitPrice = getUnitPrice(svc, serviceType);
                  const lineTotal = unitPrice * qty;
                  return (
                    <div key={svc.id} className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all",
                      qty > 0 ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/40 hover:bg-muted/60"
                    )}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">{svc.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(unitPrice)}</p>
                      </div>
                      {qty > 0 && (
                        <span className="text-xs font-semibold text-primary whitespace-nowrap">
                          {formatCurrency(lineTotal)}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button variant="outline" size="icon" className="h-7 w-7"
                          onClick={() => setItemQty(svc.id, qty - 1)} disabled={qty === 0}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className={cn(
                          "w-7 text-center text-sm font-bold tabular-nums",
                          qty > 0 ? "text-primary" : "text-muted-foreground"
                        )}>{qty}</span>
                        <Button variant="outline" size="icon" className="h-7 w-7"
                          onClick={() => setItemQty(svc.id, qty + 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                };

                if (serviceSearch.trim()) {
                  const q = serviceSearch.toLowerCase();
                  const filtered = activeServices.filter(s => s.name.toLowerCase().includes(q));
                  if (filtered.length === 0) {
                    return (
                      <div className="py-8 text-center text-muted-foreground text-sm border rounded-xl">
                        No services match "<span className="font-medium">{serviceSearch}</span>"
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</p>
                      {filtered.map(serviceRow)}
                    </div>
                  );
                }

                return (
                  <div className="space-y-5">
                    {Object.entries(servicesByCategory).map(([category, svcs]) => (
                      <div key={category}>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{category}</p>
                        <div className="space-y-1.5">{svcs.map(serviceRow)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div>
                <Label>Notes <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Input
                  className="mt-1.5"
                  placeholder="e.g. starch collars, handle with care..."
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="p-3 bg-muted/40 rounded-lg flex justify-between items-center text-sm border">
                <span className="text-muted-foreground">Items Subtotal</span>
                <span className="font-semibold">{formatCurrency(subtotal)}</span>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Discount</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Amount (₦)</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min={0}
                      value={discount || ""}
                      onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">
                      Reason {discount > 0 && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g. loyalty discount"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Extra Charge</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Amount (₦)</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      min={0}
                      value={extraCharge || ""}
                      onChange={(e) => setExtraCharge(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">
                      Reason {extraCharge > 0 && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g. delivery fee"
                      value={extraChargeReason}
                      onChange={(e) => setExtraChargeReason(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-card border rounded-xl space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {extraCharge > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Extra charge</span>
                    <span className="text-orange-600">+{formatCurrency(extraCharge)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="text-green-600">-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base border-t pt-2">
                  <span>Total Due</span>
                  <span>{formatCurrency(totalDue)}</span>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm">Customer</p>
                </div>
                <div className="px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{effectiveName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span>{effectivePhone}</span>
                  </div>
                  {effectiveAddress && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Address</span>
                      <span className="text-right max-w-[60%]">{effectiveAddress}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm capitalize">{serviceType} Service</p>
                  {readyBy && (
                    <span className="text-xs text-muted-foreground ml-1">
                      · Ready by {readyBy.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm">Items ({itemCount})</p>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  {Array.from(selectedItems.entries())
                    .filter(([, qty]) => qty > 0)
                    .map(([serviceId, qty]) => {
                      const svc = services.find(s => s.id === serviceId);
                      if (!svc) return null;
                      const unitPrice = getUnitPrice(svc, serviceType);
                      return (
                        <div key={serviceId} className="flex justify-between text-sm">
                          <span>{qty}× {svc.name}</span>
                          <span className="text-muted-foreground font-medium">{formatCurrency(unitPrice * qty)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold text-sm">Pricing</p>
                </div>
                <div className="px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  {extraCharge > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Extra charge {extraChargeReason && `(${extraChargeReason})`}</span>
                      <span className="text-orange-600">+{formatCurrency(extraCharge)}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount {discountReason && `(${discountReason})`}</span>
                      <span className="text-green-600">-{formatCurrency(discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base border-t pt-2">
                    <span>Total Due</span>
                    <span>{formatCurrency(totalDue)}</span>
                  </div>
                </div>
              </div>

              {additionalNotes && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <p className="font-semibold text-sm">Notes</p>
                  </div>
                  <div className="px-4 py-3 text-sm text-muted-foreground italic">"{additionalNotes}"</div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-row gap-2 shrink-0">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={createMutation.isPending}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={validateAndNext} disabled={createMutation.isPending}>
            {createMutation.isPending
              ? "Creating..."
              : step === STEPS.length - 1
              ? "Create Order"
              : <><span>Next</span><ChevronRight className="h-4 w-4 ml-1" /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
