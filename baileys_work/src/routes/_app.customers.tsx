import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Loader2, UserRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { inr } from "@/lib/format";
import { onEnterFocusNext } from "@/lib/keyboard-nav";

export const Route = createFileRoute("/_app/customers")({ component: Customers });

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  balance: number;
};

function emptyCustomer() {
  return { name: "", phone: "", email: "", address: "", gstin: "" };
}

function Customers() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyCustomer());
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["customers-page"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const filtered = rows.filter(c => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [c.name, c.phone, c.email, c.gstin].some(v => String(v ?? "").toLowerCase().includes(s));
  });

  const set = (key: keyof ReturnType<typeof emptyCustomer>, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const openAdd = () => {
    setForm(emptyCustomer());
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 80);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) return toast.error("Customer name is required");
    setSaving(true);
    try {
      const payload = {
        name,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        gstin: form.gstin.trim() || null,
      };
      const { error } = await supabase.from("customers").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Customer added");
      await qc.invalidateQueries({ queryKey: ["customers-page"] });
      await qc.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
      setForm(emptyCustomer());
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteCustomer) return;
    const { error } = await supabase.from("customers").delete().eq("id", deleteCustomer.id);
    if (error) return toast.error(error.message);
    toast.success("Customer deleted");
    await qc.invalidateQueries({ queryKey: ["customers-page"] });
    await qc.invalidateQueries({ queryKey: ["customers"] });
    setDeleteCustomer(null);
  };

  return (
    <>
    <div className="p-4 h-[calc(100vh-3rem)] flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Customers</h1>
          <p className="text-sm text-muted-foreground">{rows.length} customers</p>
        </div>
        <div className="flex-1" />
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, phone, GSTIN" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" />Add customer</Button>
      </div>

      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left py-2 px-3">Name</th>
                <th className="text-left py-2">Phone</th>
                <th className="text-left py-2">Email</th>
                <th className="text-left py-2">GSTIN</th>
                <th className="text-right py-2 px-3">Balance</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading customers…</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="py-2 px-3 font-medium">{c.name}</td>
                  <td className="py-2">{c.phone ?? "—"}</td>
                  <td className="py-2">{c.email ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{c.gstin ?? "—"}</td>
                  <td className="py-2 px-3 text-right font-mono">{inr(Number(c.balance))}</td>
                  <td className="py-2 px-2 text-right"><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteCustomer(c)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">
                  {rows.length ? "No customers match your search." : "No customers yet — click Add customer to create one."}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />Add customer</DialogTitle>
          </DialogHeader>
          <div data-enter-nav onKeyDown={onEnterFocusNext} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name *</Label>
              <Input ref={nameRef} value={form.name} onChange={e => set("name", e.target.value)} />
            </div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} inputMode="tel" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
            <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => set("address", e.target.value)} /></div>
            <div><Label>GSTIN</Label><Input value={form.gstin} onChange={e => set("gstin", e.target.value.toUpperCase())} /></div>
          </div>
          <DialogFooter>
            <Button type="button" data-enter-skip variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {saving ? "Saving…" : "Save customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    <AlertDialog open={!!deleteCustomer} onOpenChange={(open) => !open && setDeleteCustomer(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete customer?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently delete <strong>{deleteCustomer?.name}</strong> and its customer record.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void remove()}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
