import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { GitBranch, MapPin, Pencil, Plus, Trash2, Users, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function BranchesPage() {
  usePageTitle("Branches");
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", address: "" });

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches"],
    queryFn: () => api.branches.list(),
  });
  const { data: workers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => api.workers.list(),
  });

  const workerCountByBranch = workers.reduce<Record<number, number>>((acc, worker) => {
    if (worker.branchId != null) acc[worker.branchId] = (acc[worker.branchId] ?? 0) + 1;
    return acc;
  }, {});

  const createMutation = useMutation({
    mutationFn: (data: { name: string; address?: string }) => api.branches.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch created");
      closeDialog();
    },
    onError: (e: Error) => toast.error("Could not create branch — " + e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; address?: string } }) => api.branches.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch updated");
      closeDialog();
    },
    onError: (e: Error) => toast.error("Could not update branch — " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.branches.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch deleted");
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error("Could not delete branch — " + e.message),
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ name: "", address: "" });
  }

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", address: "" });
    setDialogOpen(true);
  }

  function openEdit(branch: any) {
    setEditingId(branch.id);
    setForm({ name: branch.name, address: branch.address ?? "" });
    setDialogOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Branch name is required");
      return;
    }
    const data = { name, address: form.address.trim() || undefined };
    if (editingId != null) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate(data);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Branches</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {branches.length} branch{branches.length !== 1 ? "es" : ""} · Organise orders and workers by location
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Branch</Button>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm">
          <p className="font-semibold">Branches are locations, not workflow types.</p>
          <p className="text-muted-foreground mt-1">
            Every branch can create and process orders. Orders stay associated with the branch where they were created.
            If a worker needs to work on orders from another branch, the owner can enable
            <strong className="text-foreground"> View orders from all branches</strong> in Worker Permissions.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-36 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No branches yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first location.</p>
            <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Branch</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map(branch => (
            <Card key={branch.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <GitBranch className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{branch.name}</CardTitle>
                      {branch.address
                        ? <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1"><MapPin className="h-3 w-3" /><span className="truncate">{branch.address}</span></div>
                        : <p className="text-xs text-muted-foreground mt-1">No address set</p>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(branch)} aria-label="Edit branch"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(branch.id)} aria-label="Delete branch"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                    <p className="text-lg font-bold">{workerCountByBranch[branch.id] ?? 0}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Users className="h-3 w-3" />Workers</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2.5 text-center">
                    <p className="text-sm font-semibold">{new Date(branch.createdAt).toLocaleDateString("en-NG", { month: "short", year: "numeric" })}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5"><Calendar className="h-3 w-3" />Opened</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={open => open ? setDialogOpen(true) : closeDialog()}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader><DialogTitle>{editingId != null ? "Edit Branch" : "Add Branch"}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="branch-name">Branch Name *</Label>
                <Input id="branch-name" placeholder="e.g. Ikeja Branch" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="branch-address">Address</Label>
                <Input id="branch-address" placeholder="Optional location" value={form.address} onChange={e => setForm(v => ({ ...v, address: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving…" : editingId != null ? "Save Changes" : "Create Branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{branches.find(b => b.id === deleteId)?.name}</strong>.
              Active orders and workers must be completed/reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete Branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
