import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Expenditure, type ExpenditureInput, type ExpenseCategory } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Receipt, Plus, Pencil, Trash2, TrendingDown, Zap,
  Droplets, Wind, Users, Truck, Wrench, Package, MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

const CATEGORIES: { value: ExpenseCategory; label: string; icon: any; color: string }[] = [
  { value: "electricity", label: "Electricity", icon: Zap, color: "text-yellow-500" },
  { value: "detergent", label: "Detergent", icon: Droplets, color: "text-blue-500" },
  { value: "water", label: "Water", icon: Wind, color: "text-cyan-500" },
  { value: "salaries", label: "Salaries", icon: Users, color: "text-purple-500" },
  { value: "transport", label: "Transport", icon: Truck, color: "text-orange-500" },
  { value: "maintenance", label: "Maintenance", icon: Wrench, color: "text-red-500" },
  { value: "packaging", label: "Packaging", icon: Package, color: "text-green-500" },
  { value: "miscellaneous", label: "Miscellaneous", icon: MoreHorizontal, color: "text-gray-500" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
];

const fmt = (v: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₦${(v / 1_000).toFixed(0)}K`;
  return fmt(v);
};

function getCategoryInfo(value: string) {
  return CATEGORIES.find(c => c.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
}

interface ExpenseFormProps {
  initial?: Expenditure | null;
  onClose: () => void;
  onSave: (data: ExpenditureInput) => void;
  loading: boolean;
}

function ExpenseForm({ initial, onClose, onSave, loading }: ExpenseFormProps) {
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "electricity");
  const [amount, setAmount] = useState(initial ? String(parseFloat(initial.amount)) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isRecurring, setIsRecurring] = useState(initial?.isRecurring ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    onSave({ category, amount: num, notes: notes || undefined, isRecurring });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => {
              const Icon = c.icon;
              return (
                <SelectItem key={c.value} value={c.value}>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${c.color}`} />
                    {c.label}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Amount (₦)</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <Input
          placeholder="e.g. NEPA bill for May"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isRecurring}
          onChange={e => setIsRecurring(e.target.checked)}
          className="rounded border-border"
        />
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          Recurring expense
        </span>
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : initial ? "Update" : "Add Expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function Expenditures() {
  const [period, setPeriod] = useState("30d");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expenditure | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expenditure | null>(null);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["expenditures", period],
    queryFn: () => api.expenditures.list(period),
  });

  const { data: summary } = useQuery({
    queryKey: ["expenditures", "summary", period],
    queryFn: () => api.expenditures.summary(period),
  });

  const createMutation = useMutation({
    mutationFn: (data: ExpenditureInput) => api.expenditures.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenditures"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      setFormOpen(false);
      toast.success("Expense added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExpenditureInput> }) =>
      api.expenditures.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenditures"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      setEditTarget(null);
      toast.success("Expense updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.expenditures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenditures"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      setDeleteTarget(null);
      toast.success("Expense deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sortedCategories = summary
    ? Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Expenditures</h1>
          <p className="text-sm text-muted-foreground">Track operational costs and expenses</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={period} onValueChange={setPeriod}>
            <TabsList>
              {PERIODS.map(p => (
                <TabsTrigger key={p.value} value={p.value}>{p.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button onClick={() => setFormOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="col-span-2">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Total Expenses</p>
                <p className="text-2xl font-bold text-red-600">{fmtShort(summary?.total ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">{summary?.count ?? 0} entries</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {sortedCategories.slice(0, 2).map(([cat, amount]) => {
          const info = getCategoryInfo(cat);
          const Icon = info.icon;
          return (
            <Card key={cat}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1 capitalize">{info.label}</p>
                    <p className="text-xl font-bold truncate">{fmtShort(amount)}</p>
                  </div>
                  <Icon className={`h-5 w-5 ${info.color} shrink-0 mt-0.5`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {sortedCategories.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Breakdown by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {sortedCategories.map(([cat, amount]) => {
                const info = getCategoryInfo(cat);
                const Icon = info.icon;
                const pct = summary!.total > 0 ? (amount / summary!.total) * 100 : 0;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 ${info.color}`} />
                        <span>{info.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground text-xs">{pct.toFixed(0)}%</span>
                        <span className="font-medium">{fmtShort(amount)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            All Expenses
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No expenses recorded</p>
              <p className="text-sm mt-1">Add your first expense to track operational costs</p>
              <Button variant="outline" className="mt-4 gap-2" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Expense
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {items.map(item => {
                const info = getCategoryInfo(item.category);
                const Icon = info.icon;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
                      <Icon className={`h-4 w-4 ${info.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium capitalize">{info.label}</p>
                        {item.isRecurring && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 gap-0.5">
                            <RefreshCw className="h-2.5 w-2.5" />
                            Recurring
                          </Badge>
                        )}
                      </div>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground truncate">{item.notes}</p>
                      )}
                      <p className="text-xs text-muted-foreground/70">
                        {format(new Date(item.createdAt), "MMM d, yyyy")}
                        {" · "}
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-base font-bold text-red-600">
                        {fmt(parseFloat(item.amount))}
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditTarget(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Expense
            </DialogTitle>
          </DialogHeader>
          <ExpenseForm
            onClose={() => setFormOpen(false)}
            onSave={data => createMutation.mutate(data)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit Expense
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <ExpenseForm
              initial={editTarget}
              onClose={() => setEditTarget(null)}
              onSave={data => updateMutation.mutate({ id: editTarget.id, data })}
              loading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the{" "}
              <strong>{deleteTarget && getCategoryInfo(deleteTarget.category).label}</strong>{" "}
              expense of{" "}
              <strong>{deleteTarget && fmt(parseFloat(deleteTarget.amount))}</strong>.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
