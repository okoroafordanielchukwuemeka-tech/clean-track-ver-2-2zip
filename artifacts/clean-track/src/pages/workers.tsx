import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type WorkerInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const emptyForm: Partial<WorkerInput> = {
  role: "worker",
  isActive: true,
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

  const createMutation = useMutation({
    mutationFn: (data: WorkerInput) => api.workers.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDialog(false);
      setForm(emptyForm);
      toast.success("Worker added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<WorkerInput> }) => api.workers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDialog(false);
      setEditId(null);
      setForm(emptyForm);
      toast.success("Worker updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.workers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
      setShowDelete(null);
      toast.success("Worker removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (w: any) => {
    setEditId(w.id);
    setForm({ name: w.name, phone: w.phone || "", role: w.role, pin: w.pin || "", isActive: w.isActive });
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
    };
    if (editId) updateMutation.mutate({ id: editId, data });
    else createMutation.mutate(data);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workers</h1>
        <Button onClick={() => { setEditId(null); setForm(emptyForm); setShowDialog(true); }}>
          <Plus className="h-4 w-4" /> Add Worker
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{workers.length} worker{workers.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>{w.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={w.role === "admin" ? "default" : "secondary"} className="capitalize">
                        {w.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{"••••"}</TableCell>
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
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      No workers yet
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
            <div>
              <Label>Name *</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+234..." />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role ?? "worker"} onValueChange={(v) => setForm({ ...form, role: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
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

      <Dialog open={showDelete != null} onOpenChange={(open) => { if (!open) setShowDelete(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove Worker</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to remove this worker?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => showDelete && deleteMutation.mutate(showDelete)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
