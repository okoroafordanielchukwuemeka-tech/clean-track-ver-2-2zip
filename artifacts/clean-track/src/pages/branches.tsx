import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { GitBranch, Plus, Pencil, Trash2, MapPin, Users, Calendar } from "lucide-react";

export default function BranchesPage() {
  usePageTitle("Branches");
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string; address: string } | null>(null);
  const [form, setForm] = useState({ name: "", address: "" });

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches"],
    queryFn: () => api.branches.list(),
  });

  const { data: workers = [] } = useQuery({
    queryKey: ["workers"],
    queryFn: () => api.workers.list(),
  });

  const workerCountByBranch = workers.reduce<Record<number, number>>((acc, w) => {
    if (w.branchId != null) {
      acc[w.branchId] = (acc[w.branchId] ?? 0) + 1;
    }
    return acc;
  }, {});

  const activeWorkerCountByBranch = workers.reduce<Record<number, number>>((acc, w) => {
    if (w.branchId != null && w.isActive) {
      acc[w.branchId] = (acc[w.branchId] ?? 0) + 1;
    }
    return acc;
  }, {});

  const branchToDelete = branches.find(b => b.id === deleteId);

  const createMut = useMutation({
    mutationFn: (data: { name: string; address?: string }) => api.branches.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch created successfully");
      setDialogOpen(false);
      setForm({ name: "", address: "" });
    },
    onError: (e: Error) => toast.error("Could not create branch — " + (e.message || "please try again.")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; address?: string } }) =>
      api.branches.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch details updated");
      setEditing(null);
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error("Could not update branch — " + (e.message || "please try again.")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.branches.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch deleted");
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error("Could not delete branch — " + (e.message || "please try again.")),
  });

  const handleOpen = (branch?: typeof branches[0]) => {
    if (branch) {
      setEditing({ id: branch.id, name: branch.name, address: branch.address ?? "" });
      setForm({ name: branch.name, address: branch.address ?? "" });
    } else {
      setEditing(null);
      setForm({ name: "", address: "" });
    }
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { name: form.name.trim(), address: form.address.trim() || undefined };
    if (editing) {
      updateMut.mutate({ id: editing.id, data });
    } else {
      createMut.mutate(data);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            Branches
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your laundry locations · {branches.length} branch{branches.length !== 1 ? "es" : ""}
          </p>
        </div>
        <Button onClick={() => handleOpen()}>
          <Plus className="h-4 w-4 mr-2" />
          Add Branch
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="border rounded-lg p-5 bg-card h-32 animate-pulse bg-muted" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No branches yet</p>
          <p className="text-sm mt-1">Create your first branch to start organising by location.</p>
          <Button className="mt-4" onClick={() => handleOpen()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Branch
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map(branch => {
            const total = workerCountByBranch[branch.id] ?? 0;
            const active = activeWorkerCountByBranch[branch.id] ?? 0;
            return (
              <div key={branch.id} className="border rounded-xl p-5 bg-card space-y-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <GitBranch className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{branch.name}</p>
                      {branch.address ? (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{branch.address}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">No address set</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpen(branch)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(branch.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="text-lg font-bold">{total}</p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
                      <Users className="h-3 w-3" /> Workers
                    </p>
                    {total > 0 && active < total && (
                      <p className="text-xs text-amber-600 mt-0.5">{active} active</p>
                    )}
                    {total > 0 && active === total && (
                      <p className="text-xs text-green-600 mt-0.5">All active</p>
                    )}
                  </div>
                  <div className="bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="text-lg font-bold text-muted-foreground">
                      {new Date(branch.createdAt).toLocaleDateString("en-NG", { month: "short", year: "numeric" })}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
                      <Calendar className="h-3 w-3" /> Opened
                    </p>
                  </div>
                </div>

                {total === 0 && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    No workers assigned
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Branch" : "Add Branch"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Branch Name *</Label>
              <Input
                id="name"
                placeholder="e.g. Ikeja Location"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="address"
                placeholder="e.g. 12 Allen Avenue, Ikeja"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {editing ? "Save Changes" : "Create Branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{branchToDelete?.name}</strong>. Existing orders and customers linked to this branch will remain but will no longer be branch-scoped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMut.mutate(deleteId)}
            >
              Delete Branch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
