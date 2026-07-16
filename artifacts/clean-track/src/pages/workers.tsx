import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type WorkerInput } from "@/lib/api";
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
import { Plus, Pencil, Trash2, GitBranch, UserCheck } from "lucide-react";
import { toast } from "sonner";

const emptyForm: Partial<WorkerInput> = {
  role: "worker",
  isActive: true,
  branchId: null,
};

export default function Workers() {
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<WorkerInput>>(emptyForm);
  const [showDelete, setShowDelete] = useState<number | null>(null);

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: () => api.workers.list(),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => api.branches.list(),
  });

  const branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));

  const createMutation = useMutation({
    mutationFn: (data: WorkerInput) => api.workers.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDialog(false);
      setForm(emptyForm);
      toast.success("Worker added successfully");
    },
    onError: (e: Error) => toast.error("Could not add worker — " + (e.message || "please try again.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WorkerInput> }) => api.workers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDialog(false);
      setEditId(null);
      setForm(emptyForm);
      toast.success("Worker details updated");
    },
    onError: (e: Error) => toast.error("Could not update worker — " + (e.message || "please try again.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.workers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDelete(null);
      toast.success("Worker removed");
    },
    onError: (e: Error) => toast.error("Could not remove worker — " + (e.message || "please try again.")),
  });

  const openEdit = (w: any) => {
    setEditId(w.id);
    setForm({ name: w.name, phone: w.phone || "", role: w.role, pin: w.pin || "", isActive: w.isActive, branchId: w.branchId ?? null });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.name) { toast.error("Name is required"); return; }
    const data: WorkerInput = {
      name: form.name,
      phone: form.phone || "",
      role: (form.role ?? "worker") as "admin" | "worker",
      pin: form.pin || "",
      isActive: form.isActive ?? true,
      branchId: form.branchId ?? null,
    };
    if (editId) updateMutation.mutate({ id: editId, data });
    else createMutation.mutate(data);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const workerToDelete = workers.find(w => w.id === showDelete);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Workers</h1>
          <p className="text-sm text-muted-foreground">Manage staff access and branch assignments</p>
        </div>
        <Button onClick={() => { setEditId(null); setForm(emptyForm); setShowDialog(true); }} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Add Worker</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{workers.length} worker{workers.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                  </div>
                  <div className="h-5 w-16 bg-muted animate-pulse rounded" />
                  <div className="h-5 w-12 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Branch</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">PIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">
                      <span className="block">{w.name}</span>
                      <span className="sm:hidden text-xs text-muted-foreground">
                        {w.branchId ? branchMap[w.branchId] ?? `Branch ${w.branchId}` : "No branch"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {w.branchId ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                          {branchMap[w.branchId] ?? `Branch ${w.branchId}`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No branch</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{w.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={w.role === "admin" ? "default" : "secondary"} className="capitalize">
                        {w.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{"••••"}</TableCell>
                    <TableCell>
                      <Badge variant={w.isActive ? "success" : "secondary"}>
                        {w.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(w)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setShowDelete(w.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!workers.length && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="text-center py-14 space-y-3">
                        <UserCheck className="h-10 w-10 mx-auto text-muted-foreground/40" />
                        <div>
                          <p className="font-medium text-foreground">No workers yet</p>
                          <p className="text-sm text-muted-foreground mt-1">Add your first worker so they can log in and process orders.</p>
                        </div>
                        <Button size="sm" onClick={() => setShowDialog(true)}>
                          Add Your First Worker
                        </Button>
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
            <DialogTitle>{editId ? "Edit Worker" : "Add Worker"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select
                value={form.branchId != null ? String(form.branchId) : "none"}
                onValueChange={(v) => setForm({ ...form, branchId: v === "none" ? null : parseInt(v) })}
              >
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No branch assigned</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="080..." />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role ?? "worker"} onValueChange={(v) => setForm({ ...form, role: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>PIN (4-digit login code)</Label>
              <Input
                value={form.pin ?? ""}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
                placeholder="e.g. 1234"
                maxLength={4}
                type="password"
              />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="worker-active" checked={form.isActive ?? true} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              <Label htmlFor="worker-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setEditId(null); setForm(emptyForm); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : editId ? "Update" : "Add Worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDelete != null} onOpenChange={(open) => { if (!open) setShowDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Worker?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{workerToDelete?.name}</strong> from your account. Their work history will remain attached to any orders they processed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => showDelete && deleteMutation.mutate(showDelete)}
            >
              {deleteMutation.isPending ? "Removing..." : "Remove Worker"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
