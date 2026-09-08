import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { onEnterFocusNext } from "@/lib/keyboard-nav";

export const Route = createFileRoute("/_app/customers")({ component: Customers });

function Customers() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(""); setPhone(""); setEmail(""); setAddress(""); setGstin("");
  };

  const saveCustomer = async () => {
    if (!name.trim()) return toast.error("Customer name is required");
    setSaving(true);
    try {
      const { error } = await supabase.from("customers").insert({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        gstin: gstin.trim() || null,
      });
      if (error) return toast.error(error.message);
      toast.success("Customer added");
      await qc.invalidateQueries({ queryKey: ["customers-page"] });
      await qc.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const { data: rows = [] } = useQuery({
    queryKey: ["customers-page"],
    queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
  });
  return (
    <div className="p-4 h-[calc(100vh-3rem)] flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage your customer directory</p>
        </div>
        <div className="flex-1" />
        <Button onClick={() => setOpen(true)}>+ Add customer</Button>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add customer</DialogTitle></DialogHeader>
          <div data-enter-nav onKeyDown={onEnterFocusNext} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name *</Label><Input autoFocus value={name} onChange={e => setName(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" /></div>
            <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div className="col-span-2"><Label>Address</Label><Input value={address} onChange={e => setAddress(e.target.value)} /></div>
            <div><Label>GSTIN</Label><Input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} /></div>
            <DialogFooter className="col-span-2">
              <Button variant="outline" data-enter-skip onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-enter-submit disabled={saving} onClick={saveCustomer}>{saving ? "Saving…" : "Save customer"}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="text-left py-2 px-3">Name</th><th className="text-left py-2">Phone</th><th className="text-left py-2">Email</th><th className="text-left py-2">GSTIN</th><th className="text-right py-2 px-3">Balance</th></tr>
            </thead>
            <tbody>
              {rows.map((c: any) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="py-2 px-3 font-medium">{c.name}</td>
                  <td className="py-2">{c.phone ?? "—"}</td>
                  <td className="py-2">{c.email ?? "—"}</td>
                  <td className="py-2 font-mono text-xs">{c.gstin ?? "—"}</td>
                  <td className="py-2 px-3 text-right font-mono">{inr(Number(c.balance))}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No customers yet — click “Add customer” to create one.</td></tr>}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </div>
  );
}
