import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { api, type ServiceInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Package, Archive, ArchiveRestore, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const SERVICE_CATEGORIES = [
  "Washing",
  "Dry Cleaning",
  "Ironing",
  "Wash & Fold",
  "Household Items",
  "Shoes & Bags",
  "Bedding & Linen",
  "Specialty Items",
  "Other",
];

type Filter = "active" | "archived" | "all";

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));
}

const emptyForm: Partial<ServiceInput> = {
  isActive: true,
};

export default function Services() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<ServiceInput>>(emptyForm);
  const [showDelete, setShowDelete] = useState<number | null>(null);

  const { data: services = [], isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["services", filter],
    queryFn: () => api.services.list({ filter }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["services"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: ServiceInput) => api.services.create(data),
    onSuccess: () => {
      invalidate();
      setShowDialog(false);
      setForm(emptyForm);
      toast.success("Service created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ServiceInput> }) => api.services.update(id, data),
    onSuccess: () => {
      invalidate();
      setShowDialog(false);
      setEditId(null);
      setForm(emptyForm);
      toast.success("Service updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.services.delete(id),
    onSuccess: () => {
      invalidate();
      setShowDelete(null);
      toast.success("Service deleted");
    },
    onError: (e: Error) => {
      setShowDelete(null);
      toast.error(e.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.services.archive(id),
    onSuccess: () => {
      invalidate();
      toast.success("Service archived — it won't appear in new orders.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.services.restore(id),
    onSuccess: () => {
      invalidate();
      toast.success("Service restored — it's available for new orders again.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: "up" | "down" }) =>
      api.services.reorder(id, direction),
    onSuccess: () => {
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (svc: any) => {
    setEditId(svc.id);
    setForm({
      name: svc.name,
      category: svc.category,
      standardPrice: Number(svc.standardPrice),
      expressPrice: svc.expressPrice != null ? Number(svc.expressPrice) : undefined,
      premiumPrice: svc.premiumPrice != null ? Number(svc.premiumPrice) : undefined,
      isActive: svc.isActive,
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.name || !form.category || form.standardPrice == null) {
      toast.error("Name, category and standard price are required");
      return;
    }
    const data: ServiceInput = {
      name: form.name,
      category: form.category,
      standardPrice: Number(form.standardPrice),
      expressPrice: form.expressPrice != null ? Number(form.expressPrice) : undefined,
      premiumPrice: form.premiumPrice != null ? Number(form.premiumPrice) : undefined,
      isActive: form.isActive ?? true,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const TABS: { label: string; value: Filter }[] = [
    { label: "Active", value: "active" },
    { label: "Archived", value: "archived" },
    { label: "All Services", value: "all" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">Services</h1>
          <CachedDataBadge show={isViewingCache} />
        </div>
        <Button onClick={() => { setEditId(null); setForm(emptyForm); setShowDialog(true); }}>
          <Plus className="h-4 w-4" /> Add Service
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {services.length} service{services.length !== 1 ? "s" : ""}
            {filter === "active" && " (active)"}
            {filter === "archived" && " (archived)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Standard</TableHead>
                  <TableHead>Express</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((svc, idx) => (
                  <TableRow key={svc.id} className={!svc.isActive ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          disabled={idx === 0 || reorderMutation.isPending}
                          onClick={() => reorderMutation.mutate({ id: svc.id, direction: "up" })}
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          disabled={idx === services.length - 1 || reorderMutation.isPending}
                          onClick={() => reorderMutation.mutate({ id: svc.id, direction: "down" })}
                          title="Move down"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{svc.name}</TableCell>
                    <TableCell>{svc.category}</TableCell>
                    <TableCell>{formatCurrency(svc.standardPrice as any)}</TableCell>
                    <TableCell>{formatCurrency(svc.expressPrice as any)}</TableCell>
                    <TableCell>{formatCurrency(svc.premiumPrice as any)}</TableCell>
                    <TableCell>
                      <Badge variant={svc.isActive ? "success" : "secondary"}>
                        {svc.isActive ? "Active" : "Archived"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(svc)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {svc.isActive ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => archiveMutation.mutate(svc.id)}
                            disabled={archiveMutation.isPending}
                            title="Archive"
                          >
                            <Archive className="h-4 w-4 text-amber-500" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => restoreMutation.mutate(svc.id)}
                            disabled={restoreMutation.isPending}
                            title="Restore"
                          >
                            <ArchiveRestore className="h-4 w-4 text-green-500" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowDelete(svc.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!services.length && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <div className="text-center py-14 space-y-3">
                        <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
                        <div>
                          {filter === "archived" ? (
                            <>
                              <p className="font-medium text-foreground">No archived services</p>
                              <p className="text-sm text-muted-foreground mt-1">Services you archive will appear here.</p>
                            </>
                          ) : (
                            <>
                              <p className="font-medium text-foreground">No services yet</p>
                              <p className="text-sm text-muted-foreground mt-1">Add your laundry services so you can attach them to orders.</p>
                            </>
                          )}
                        </div>
                        {filter !== "archived" && (
                          <Button size="sm" onClick={() => setShowDialog(true)}>
                            Add Your First Service
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditId(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Service" : "Add Service"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Shirt Wash" />
            </div>
            <div>
              <Label>Category *</Label>
              <Select
                value={SERVICE_CATEGORIES.includes(form.category ?? "") ? (form.category ?? "") : form.category ? "Other" : ""}
                onValueChange={(val) => {
                  if (val === "Other") {
                    setForm({ ...form, category: "" });
                  } else {
                    setForm({ ...form, category: val });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(form.category !== undefined && !SERVICE_CATEGORIES.includes(form.category ?? "")) && (
                <Input
                  className="mt-2"
                  value={form.category ?? ""}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Enter custom category"
                />
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Standard (₦) *</Label>
                <Input type="number" min={0} value={form.standardPrice ?? ""} onChange={(e) => setForm({ ...form, standardPrice: parseFloat(e.target.value) })} />
              </div>
              <div>
                <Label className="text-xs">Express (₦)</Label>
                <Input type="number" min={0} value={form.expressPrice ?? ""} onChange={(e) => setForm({ ...form, expressPrice: parseFloat(e.target.value) || undefined })} />
              </div>
              <div>
                <Label className="text-xs">Premium (₦)</Label>
                <Input type="number" min={0} value={form.premiumPrice ?? ""} onChange={(e) => setForm({ ...form, premiumPrice: parseFloat(e.target.value) || undefined })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditId(null); setForm(emptyForm); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDelete != null} onOpenChange={(open) => { if (!open) setShowDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this service. If it has been used in past orders, you'll be prompted to archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => showDelete && deleteMutation.mutate(showDelete)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
