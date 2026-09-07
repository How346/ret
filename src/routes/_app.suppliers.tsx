import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { inr } from "@/lib/format";
import { onEnterFocusNext } from "@/lib/keyboard-nav";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  balance: number;
};

export const Route = createFileRoute("/_app/suppliers")({
  component: SuppliersPage,
});

function SuppliersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [search, setSearch] = useState("");

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  const save = useMutation({
    mutationFn: async (s: Partial<Supplier>) => {
      if (s.id) {
        const { error } = await supabase.from("suppliers").update(s).eq("id", s.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(s as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false); setEditing(null);
      toast.success("Supplier saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = suppliers.filter((s) =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.phone?.includes(search) ||
    s.gstin?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6" /> Suppliers</h1>
          <p className="text-sm text-muted-foreground">Manage vendor accounts, GSTIN and outstanding balances.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-1" /> New Supplier</Button>
            </DialogTrigger>
            <SupplierDialog editing={editing} onSave={(s) => save.mutate(s)} />
          </Dialog>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.phone}</TableCell>
                <TableCell className="font-mono text-xs">{s.gstin}</TableCell>
                <TableCell>{s.state}</TableCell>
                <TableCell className="text-right font-mono">{inr(s.balance)}</TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete supplier?")) remove.mutate(s.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No suppliers yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SupplierDialog({ editing, onSave }: { editing: Supplier | null; onSave: (s: Partial<Supplier>) => void }) {
  const [form, setForm] = useState<Partial<Supplier>>(
    editing ?? { name: "", phone: "", email: "", gstin: "", address: "", state: "", balance: 0 },
  );
  const upd = (k: keyof Supplier, v: any) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{editing ? "Edit Supplier" : "New Supplier"}</DialogTitle></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2" data-enter-nav onKeyDown={onEnterFocusNext}>
        <div className="sm:col-span-2"><Label>Name *</Label><Input value={form.name ?? ""} onChange={(e) => upd("name", e.target.value)} /></div>
        <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => upd("phone", e.target.value)} /></div>
        <div><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => upd("email", e.target.value)} /></div>
        <div><Label>GSTIN</Label><Input value={form.gstin ?? ""} onChange={(e) => upd("gstin", e.target.value.toUpperCase())} /></div>
        <div><Label>State</Label><Input value={form.state ?? ""} onChange={(e) => upd("state", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => upd("address", e.target.value)} /></div>
        <div><Label>Opening Balance</Label><Input type="number" value={form.balance ?? 0} onChange={(e) => upd("balance", Number(e.target.value))} /></div>
        <DialogFooter className="sm:col-span-2">
          <Button onClick={() => { if (!form.name) return; onSave(form); }}>Save</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}
