import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { api, type Service, type ServiceInput } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServiceImage, IconPicker } from "@/components/service-image";
import { suggestIconKey } from "@/lib/service-icons";
import {
  Plus, Pencil, Trash2, Package, Archive, ArchiveRestore, ChevronUp, ChevronDown,
  Search, Copy, Upload, X, Download, FileUp, BarChart3, Image as ImageIcon,
} from "lucide-react";
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
type SortOption = "most_used" | "alpha" | "recent" | "price" | "category";

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));
}

const emptyForm: Partial<ServiceInput> & { branchIds?: number[] | null } = {
  isActive: true,
  branchIds: null,
};

export default function Services() {
  const qc = useQueryClient();
  const { isOwner } = useAuth();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortOption>("category");
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<ServiceInput> & { branchIds?: number[] | null }>(emptyForm);
  const [showDelete, setShowDelete] = useState<number | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: { row: number; error: string }[] } | null>(null);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkPriceForm, setBulkPriceForm] = useState<{ priceField: "standardPrice" | "expressPrice" | "premiumPrice"; mode: "set" | "increase_percent" | "decrease_percent"; value: string }>({ priceField: "standardPrice", mode: "set", value: "" });
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { data: branches = [] } = useQuery({ queryKey: ["branches"], queryFn: () => api.branches.list(), enabled: isOwner });

  const { data: services = [], isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["services", filter],
    queryFn: () => api.services.list({ filter }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ["services", "categories"], queryFn: () => api.services.categories() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["services"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: ServiceInput) => api.services.create(data),
    onSuccess: () => { invalidate(); setShowDialog(false); setForm(emptyForm); toast.success("Service created"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ServiceInput> }) => api.services.update(id, data),
    onSuccess: () => { invalidate(); setShowDialog(false); setEditId(null); setForm(emptyForm); toast.success("Service updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.services.delete(id),
    onSuccess: () => { invalidate(); setShowDelete(null); toast.success("Service deleted"); },
    onError: (e: Error) => { setShowDelete(null); toast.error(e.message); },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.services.archive(id),
    onSuccess: () => { invalidate(); toast.success("Service archived — it won't appear in new orders."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.services.restore(id),
    onSuccess: () => { invalidate(); toast.success("Service restored — it's available for new orders again."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: "up" | "down" }) => api.services.reorder(id, direction),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => api.services.duplicate(id),
    onSuccess: () => { invalidate(); toast.success("Service duplicated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadImageMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => api.services.uploadImage(id, file),
    onSuccess: () => { invalidate(); toast.success("Image uploaded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteImageMutation = useMutation({
    mutationFn: (id: number) => api.services.deleteImage(id),
    onSuccess: () => { invalidate(); toast.success("Image removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: number[]) => api.services.bulkArchive(ids),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); toast.success(`${r.updated} service(s) archived`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkRestoreMutation = useMutation({
    mutationFn: (ids: number[]) => api.services.bulkRestore(ids),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); toast.success(`${r.updated} service(s) restored`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.services.bulkDelete(ids),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); toast.success(r.note); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkCategoryMutation = useMutation({
    mutationFn: ({ ids, category }: { ids: number[]; category: string }) => api.services.bulkCategory(ids, category),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); setBulkCategoryOpen(false); toast.success(`Updated category for ${r.updated} service(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkPriceMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.services.bulkPrice>[0]) => api.services.bulkPrice(data),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); setBulkPriceOpen(false); toast.success(`Updated pricing for ${r.updated} service(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => api.services.importCsv(file),
    onSuccess: (r) => { invalidate(); setImportResult(r); if (r.created > 0) toast.success(`Imported ${r.created} service(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics", "services"],
    queryFn: () => api.analytics.services(),
    enabled: showAnalytics,
  });

  const filteredServices = useMemo(() => {
    let list = services;
    if (categoryFilter !== "all") list = list.filter(s => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "alpha") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "price") sorted.sort((a, b) => Number(a.standardPrice) - Number(b.standardPrice));
    else if (sort === "most_used") sorted.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
    else if (sort === "recent") sorted.sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
    else if (sort === "category") sorted.sort((a, b) => a.category.localeCompare(b.category) || a.displayOrder - b.displayOrder);
    return sorted;
  }, [services, categoryFilter, search, sort]);

  const openEdit = (svc: Service) => {
    setEditId(svc.id);
    setForm({
      name: svc.name,
      category: svc.category,
      standardPrice: Number(svc.standardPrice),
      expressPrice: svc.expressPrice != null ? Number(svc.expressPrice) : undefined,
      premiumPrice: svc.premiumPrice != null ? Number(svc.premiumPrice) : undefined,
      isActive: svc.isActive,
      imageUrl: svc.imageUrl ?? null,
      branchIds: svc.branchIds ?? null,
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
      imageUrl: form.imageUrl ?? null,
      branchIds: form.branchIds ?? null,
    };
    if (editId) updateMutation.mutate({ id: editId, data });
    else createMutation.mutate(data);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const toggleSelected = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleBranchInForm = (branchId: number) => {
    setForm(f => {
      const current = f.branchIds ?? [];
      const has = current.includes(branchId);
      const next = has ? current.filter(b => b !== branchId) : [...current, branchId];
      return { ...f, branchIds: next.length ? next : null };
    });
  };

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
        <div className="flex items-center gap-2 flex-wrap">
          {isOwner && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowAnalytics(true)}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </Button>
              <Button variant="outline" size="sm" onClick={() => api.services.exportCsv().catch((e) => toast.error(e.message))}>
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setImportResult(null); setShowImport(true); }}>
                <FileUp className="h-4 w-4" /> Import
              </Button>
              <Button
                variant={bulkMode ? "default" : "outline"}
                size="sm"
                onClick={() => { setBulkMode(b => !b); setSelected(new Set()); }}
              >
                {bulkMode ? "Done" : "Select"}
              </Button>
              <Button onClick={() => { setEditId(null); setForm(emptyForm); setShowDialog(true); }}>
                <Plus className="h-4 w-4" /> Add Service
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === tab.value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search, category filter, sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services by name or category..."
            className="pl-8"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="most_used">Most Used</SelectItem>
            <SelectItem value="alpha">Alphabetical</SelectItem>
            <SelectItem value="recent">Recently Used</SelectItem>
            <SelectItem value="price">Price</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action toolbar */}
      {bulkMode && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkPriceOpen(true)}>Update Price</Button>
          <Button size="sm" variant="outline" onClick={() => setBulkCategoryOpen(true)}>Change Category</Button>
          {filter !== "archived" && (
            <Button size="sm" variant="outline" onClick={() => bulkArchiveMutation.mutate([...selected])}>
              <Archive className="h-4 w-4" /> Archive
            </Button>
          )}
          {filter === "archived" && (
            <Button size="sm" variant="outline" onClick={() => bulkRestoreMutation.mutate([...selected])}>
              <ArchiveRestore className="h-4 w-4" /> Restore
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulkDeleteMutation.mutate([...selected])}>
            <Trash2 className="h-4 w-4" /> Delete (archive)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filteredServices.length} service{filteredServices.length !== 1 ? "s" : ""}
            {filter === "active" && " (active)"}
            {filter === "archived" && " (archived)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="text-center py-14 space-y-3">
              <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <div>
                {filter === "archived" ? (
                  <>
                    <p className="font-medium text-foreground">No archived services</p>
                    <p className="text-sm text-muted-foreground mt-1">Services you archive will appear here.</p>
                  </>
                ) : search || categoryFilter !== "all" ? (
                  <>
                    <p className="font-medium text-foreground">No services match your search</p>
                    <p className="text-sm text-muted-foreground mt-1">Try a different search term or category.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground">No services yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Add your laundry services so you can attach them to orders.</p>
                  </>
                )}
              </div>
              {filter !== "archived" && isOwner && (
                <Button size="sm" onClick={() => setShowDialog(true)}>Add Your First Service</Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredServices.map((svc, idx) => (
                <div
                  key={svc.id}
                  className={`relative flex flex-col rounded-lg border overflow-hidden ${!svc.isActive ? "opacity-60" : ""}`}
                >
                  {bulkMode && (
                    <div className="absolute top-2 left-2 z-10 bg-background/90 rounded p-0.5">
                      <Checkbox checked={selected.has(svc.id)} onCheckedChange={() => toggleSelected(svc.id)} />
                    </div>
                  )}
                  <ServiceImage name={svc.name} imageUrl={svc.imageUrl} className="h-28 w-full" />
                  <div className="flex flex-col gap-1.5 p-3 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium leading-tight">{svc.name}</div>
                      <Badge variant={svc.isActive ? "success" : "secondary"} className="shrink-0">
                        {svc.isActive ? "Active" : "Archived"}
                      </Badge>
                    </div>
                    <Badge variant="outline" className="w-fit text-xs">{svc.category}</Badge>
                    <div className="text-sm font-semibold">{formatCurrency(svc.standardPrice as any)}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>Used {svc.usageCount ?? 0}×</span>
                      <span>·</span>
                      <span>
                        {svc.branchIds === null || svc.branchIds === undefined
                          ? "All branches"
                          : svc.branchIds.length === 0
                            ? "No branches"
                            : `${svc.branchIds.length} branch${svc.branchIds.length !== 1 ? "es" : ""}`}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center gap-0.5 pt-2 border-t flex-wrap">
                      {isOwner && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(svc)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateMutation.mutate(svc.id)} title="Duplicate">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          {svc.isActive ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => archiveMutation.mutate(svc.id)} title="Archive">
                              <Archive className="h-3.5 w-3.5 text-amber-500" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => restoreMutation.mutate(svc.id)} title="Restore">
                              <ArchiveRestore className="h-3.5 w-3.5 text-green-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDelete(svc.id)} title="Delete">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                          <div className="ml-auto flex">
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0} onClick={() => reorderMutation.mutate({ id: svc.id, direction: "up" })} title="Move up">
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === filteredServices.length - 1} onClick={() => reorderMutation.mutate({ id: svc.id, direction: "down" })} title="Move down">
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditId(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Service" : "Add Service"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ServiceImage name={form.name || "Service"} imageUrl={form.imageUrl} className="h-16 w-16 rounded-md shrink-0" />
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Upload Photo
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowImagePicker(true)}>
                    <ImageIcon className="h-3.5 w-3.5" /> Choose Icon
                  </Button>
                  {form.imageUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (editId) deleteImageMutation.mutate(editId);
                        setForm({ ...form, imageUrl: null });
                      }}
                    >
                      <X className="h-3.5 w-3.5" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">JPG, PNG or WEBP, up to 5MB. Auto-resized &amp; compressed.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { toast.error("Image is too large. Maximum size is 5MB."); return; }
                    if (editId) {
                      const updated = await uploadImageMutation.mutateAsync({ id: editId, file }).catch((err) => { toast.error(err.message); return null; });
                      if (updated) setForm({ ...form, imageUrl: updated.imageUrl });
                    } else {
                      toast.info("Save the service first, then upload a custom photo.");
                    }
                  }}
                />
              </div>
            </div>

            <div>
              <Label>Name *</Label>
              <Input
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Shirt Wash"
              />
              {!form.imageUrl && form.name && suggestIconKey(form.name) && (
                <p className="text-xs text-muted-foreground mt-1">Using a suggested icon based on the name. Choose a custom icon or photo to override.</p>
              )}
            </div>
            <div>
              <Label>Category *</Label>
              <Select
                value={SERVICE_CATEGORIES.includes(form.category ?? "") ? (form.category ?? "") : form.category ? "Other" : ""}
                onValueChange={(val) => {
                  if (val === "Other") setForm({ ...form, category: "" });
                  else setForm({ ...form, category: val });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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

            {branches.length > 0 && (
              <div>
                <Label>Branch availability</Label>
                <p className="text-xs text-muted-foreground mb-2">Leave all unchecked to make this service available everywhere.</p>
                <div className="grid grid-cols-2 gap-2">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={(form.branchIds ?? []).includes(b.id)} onCheckedChange={() => toggleBranchInForm(b.id)} />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditId(null); setForm(emptyForm); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Icon picker dialog */}
      <Dialog open={showImagePicker} onOpenChange={setShowImagePicker}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Choose a default icon</DialogTitle></DialogHeader>
          <IconPicker
            value={form.imageUrl?.startsWith("icon:") ? form.imageUrl.slice(5) : null}
            onSelect={(key) => { setForm({ ...form, imageUrl: `icon:${key}` }); setShowImagePicker(false); }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
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

      {/* Bulk price update dialog */}
      <Dialog open={bulkPriceOpen} onOpenChange={setBulkPriceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update price for {selected.size} service(s)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Price field</Label>
              <Select value={bulkPriceForm.priceField} onValueChange={(v) => setBulkPriceForm({ ...bulkPriceForm, priceField: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standardPrice">Standard</SelectItem>
                  <SelectItem value="expressPrice">Express</SelectItem>
                  <SelectItem value="premiumPrice">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={bulkPriceForm.mode} onValueChange={(v) => setBulkPriceForm({ ...bulkPriceForm, mode: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Set to exact amount</SelectItem>
                  <SelectItem value="increase_percent">Increase by %</SelectItem>
                  <SelectItem value="decrease_percent">Decrease by %</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{bulkPriceForm.mode === "set" ? "Amount (₦)" : "Percent (%)"}</Label>
              <Input type="number" min={0} value={bulkPriceForm.value} onChange={(e) => setBulkPriceForm({ ...bulkPriceForm, value: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPriceOpen(false)}>Cancel</Button>
            <Button
              disabled={!bulkPriceForm.value || bulkPriceMutation.isPending}
              onClick={() => bulkPriceMutation.mutate({ ids: [...selected], priceField: bulkPriceForm.priceField, mode: bulkPriceForm.mode, value: parseFloat(bulkPriceForm.value) })}
            >
              {bulkPriceMutation.isPending ? "Updating..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk category change dialog */}
      <Dialog open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change category for {selected.size} service(s)</DialogTitle></DialogHeader>
          <Select value={bulkCategoryValue} onValueChange={setBulkCategoryValue}>
            <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
            <SelectContent>
              {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkCategoryOpen(false)}>Cancel</Button>
            <Button
              disabled={!bulkCategoryValue || bulkCategoryMutation.isPending}
              onClick={() => bulkCategoryMutation.mutate({ ids: [...selected], category: bulkCategoryValue })}
            >
              {bulkCategoryMutation.isPending ? "Updating..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={showImport} onOpenChange={(open) => { setShowImport(open); if (!open) setImportResult(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Import services from CSV</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Columns: <code className="text-xs">name, category, standardPrice, expressPrice, premiumPrice, isActive</code>. Duplicate names (existing or within the file) are skipped and reported below.
            </p>
            <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={importMutation.isPending}>
              <FileUp className="h-4 w-4" /> {importMutation.isPending ? "Importing..." : "Choose CSV file"}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) importMutation.mutate(file);
              }}
            />
            {importResult && (
              <div className="text-sm space-y-2 rounded-md border p-3">
                <p><span className="font-medium text-foreground">{importResult.created}</span> created, <span className="font-medium text-foreground">{importResult.skipped}</span> skipped</p>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto text-xs text-muted-foreground space-y-0.5">
                    {importResult.errors.map((e, i) => <div key={i}>Row {e.row}: {e.error}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImport(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analytics dialog */}
      <Dialog open={showAnalytics} onOpenChange={setShowAnalytics}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Service Analytics</DialogTitle></DialogHeader>
          {!analytics ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-2">Most ordered</h3>
                <div className="space-y-1">
                  {analytics.mostOrdered.slice(0, 5).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">{s.itemCount} items · {s.popularityPercent}%{s.revenue != null ? ` · ${formatCurrency(s.revenue)}` : ""}</span>
                    </div>
                  ))}
                  {analytics.mostOrdered.length === 0 && <p className="text-sm text-muted-foreground">No order data yet.</p>}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">Least ordered</h3>
                <div className="space-y-1">
                  {analytics.leastOrdered.slice(0, 5).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">{s.itemCount} items</span>
                    </div>
                  ))}
                </div>
              </div>
              {analytics.neverOrdered.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Never ordered ({analytics.neverOrdered.length})</h3>
                  <div className="flex flex-wrap gap-1">
                    {analytics.neverOrdered.map(s => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold mb-2">Popularity by category</h3>
                <div className="space-y-1">
                  {analytics.categoryPopularity.map((c) => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <span>{c.category}</span>
                      <span className="text-muted-foreground">{c.itemCount} items{c.revenue != null ? ` · ${formatCurrency(c.revenue)}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
