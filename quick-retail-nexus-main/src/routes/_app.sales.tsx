import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { inr } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { Eye, Printer, Pencil, Trash2, Search, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { useStoreSettings } from "@/hooks/use-store-settings";
import { printReceipt } from "@/lib/print-receipt";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app/sales")({ component: SalesPage });

function SalesPage() {
  const qc = useQueryClient();
  const { role, user } = useAuth();
  const { data: settings } = useStoreSettings();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viewSale, setViewSale] = useState<any>(null);
  const [editSale, setEditSale] = useState<any>(null);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales-list", from, to],
    queryFn: async () => {
      let query = supabase
        .from("sales")
        .select("*, customers(name, phone, gstin)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (from) query = query.gte("created_at", new Date(from).toISOString());
      if (to) query = query.lte("created_at", new Date(to + "T23:59:59").toISOString());
      const { data } = await query;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return sales;
    return sales.filter((x: any) =>
      x.invoice_no?.toLowerCase().includes(s) ||
      x.customers?.name?.toLowerCase().includes(s) ||
      x.customers?.phone?.includes(s),
    );
  }, [sales, q]);

  const stats = useMemo(() => {
    const total = filtered.reduce((a: number, b: any) => a + Number(b.total), 0);
    const tax = filtered.reduce((a: number, b: any) => a + Number(b.cgst) + Number(b.sgst) + Number(b.igst), 0);
    const cash = filtered.reduce((a: number, b: any) => a + Number(b.paid_cash), 0);
    return { total, tax, cash, count: filtered.length };
  }, [filtered]);

  const loadItems = async (saleId: string) => {
    const { data } = await supabase.from("sale_items").select("*").eq("sale_id", saleId);
    return data ?? [];
  };

  const reprint = async (sale: any) => {
    const items = await loadItems(sale.id);
    printReceipt({
      invoiceNo: sale.invoice_no,
      date: new Date(sale.created_at),
      customer: sale.customers,
      cart: items.map((it: any) => ({
        name: it.product_name, hsn_code: it.hsn_code, qty: Number(it.qty),
        price: Number(it.price), discount: Number(it.discount), gst_rate: Number(it.gst_rate),
      })),
      totals: {
        subtotal: Number(sale.subtotal), cgst: Number(sale.cgst), sgst: Number(sale.sgst),
        igst: Number(sale.igst), discount: Number(sale.discount), total: Number(sale.total),
      },
      payment: { cash: Number(sale.paid_cash), card: Number(sale.paid_card), upi: Number(sale.paid_upi) },
      settings,
    });
  };

  const exportCsv = () => {
    const header = "Invoice,Date,Customer,Phone,Subtotal,CGST,SGST,IGST,Discount,Total,Cash,Card,UPI\n";
    const rows = filtered.map((s: any) =>
      [s.invoice_no, new Date(s.created_at).toLocaleString(), s.customers?.name ?? "Walk-in",
       s.customers?.phone ?? "", s.subtotal, s.cgst, s.sgst, s.igst, s.discount, s.total,
       s.paid_cash, s.paid_card, s.paid_upi].join(","),
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const del = async (sale: any) => {
    const items = await loadItems(sale.id);
    // restore stock
    for (const it of items) {
      if (!it.product_id) continue;
      const { data: prod } = await supabase.from("products").select("stock").eq("id", it.product_id).single();
      if (prod) await supabase.from("products").update({ stock: Number(prod.stock) + Number(it.qty) }).eq("id", it.product_id);
      await supabase.from("stock_ledger").insert({
        product_id: it.product_id, change: Number(it.qty),
        reason: "sale_void", ref_id: sale.id,
      });
    }
    await supabase.from("sale_items").delete().eq("sale_id", sale.id);
    const { error } = await supabase.from("sales").delete().eq("id", sale.id);
    if (error) return toast.error(error.message);
    toast.success(`Invoice ${sale.invoice_no} deleted, stock restored`);
    qc.invalidateQueries({ queryKey: ["sales-list"] });
  };

  const canEdit = true; // All authenticated users (incl. cashier) can edit/delete

  return (
    <div className="p-4 h-[calc(100vh-3rem)] flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Sales</h1>
          <p className="text-sm text-muted-foreground">Search, edit, reprint and audit past invoices</p>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5 mr-1" /> Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Invoices" value={String(stats.count)} />
        <Stat label="Total sales" value={inr(stats.total)} accent />
        <Stat label="Tax collected" value={inr(stats.tax)} />
        <Stat label="Cash received" value={inr(stats.cash)} />
      </div>

      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search invoice, customer or phone…" value={q} onChange={e => setQ(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-36" />
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-36" />
          {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
        </div>
      </Card>

      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/40 backdrop-blur z-10">
              <tr className="text-xs text-muted-foreground">
                <th className="text-left py-2 px-3">Invoice</th>
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Customer</th>
                <th className="text-right py-2">Subtotal</th>
                <th className="text-right py-2">Tax</th>
                <th className="text-right py-2 px-3">Total</th>
                <th className="py-2">Status</th>
                <th className="text-right py-2 pr-3 w-44">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                  <td className="py-2 px-3 font-mono">{s.invoice_no}</td>
                  <td className="py-2 whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="py-2">{s.customers?.name ?? <span className="text-muted-foreground">Walk-in</span>}</td>
                  <td className="py-2 text-right font-mono">{inr(Number(s.subtotal))}</td>
                  <td className="py-2 text-right font-mono">{inr(Number(s.cgst) + Number(s.sgst) + Number(s.igst))}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold">{inr(Number(s.total))}</td>
                  <td className="py-2"><Badge variant={s.status === "completed" ? "secondary" : "destructive"}>{s.status}</Badge></td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => setViewSale(s)}><Eye className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Reprint" onClick={() => reprint(s)}><Printer className="h-3.5 w-3.5" /></Button>
                      {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditSale(s)}><Pencil className="h-3.5 w-3.5" /></Button>}
                      {canEdit && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete invoice {s.invoice_no}?</AlertDialogTitle>
                              <AlertDialogDescription>This will void the sale and restore product stock. This cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del(s)}>Delete & restore stock</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto opacity-30 mb-2" />
                  No sales match your filters
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </Card>

      <ViewDialog sale={viewSale} onClose={() => setViewSale(null)} loadItems={loadItems} onReprint={reprint} />
      <EditDialog
        sale={editSale}
        onClose={() => setEditSale(null)}
        loadItems={loadItems}
        userId={user?.id ?? null}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["sales-list"] }); setEditSale(null); }}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={`p-3 ${accent ? "bg-primary text-primary-foreground" : ""}`}>
      <div className={`text-[11px] uppercase tracking-wider ${accent ? "opacity-80" : "text-muted-foreground"}`}>{label}</div>
      <div className="font-display text-xl font-bold tabular-nums mt-1">{value}</div>
    </Card>
  );
}

function ViewDialog({ sale, onClose, loadItems, onReprint }: any) {
  const { data: items = [] } = useQuery({
    queryKey: ["sale-items", sale?.id],
    enabled: !!sale,
    queryFn: () => loadItems(sale.id),
  });
  if (!sale) return null;
  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{sale.invoice_no}</DialogTitle>
          <p className="text-xs text-muted-foreground">{new Date(sale.created_at).toLocaleString()} · {sale.customers?.name ?? "Walk-in"}</p>
        </DialogHeader>
        <div className="max-h-80 overflow-auto border border-border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0">
              <tr><th className="text-left p-2">Item</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Price</th><th className="text-right p-2">GST%</th><th className="text-right p-2">Total</th></tr>
            </thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} className="border-t border-border">
                  <td className="p-2">{it.product_name}<div className="text-[10px] text-muted-foreground">HSN {it.hsn_code ?? "—"}</div></td>
                  <td className="p-2 text-right font-mono">{it.qty}</td>
                  <td className="p-2 text-right font-mono">{inr(Number(it.price))}</td>
                  <td className="p-2 text-right font-mono">{it.gst_rate}%</td>
                  <td className="p-2 text-right font-mono font-semibold">{inr(Number(it.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm pt-2">
          <Row k="Subtotal" v={inr(Number(sale.subtotal))} />
          <Row k="Discount" v={inr(Number(sale.discount))} />
          <Row k="CGST" v={inr(Number(sale.cgst))} />
          <Row k="SGST" v={inr(Number(sale.sgst))} />
          <Row k="Cash" v={inr(Number(sale.paid_cash))} />
          <Row k="Card" v={inr(Number(sale.paid_card))} />
          <Row k="UPI" v={inr(Number(sale.paid_upi))} />
          <Row k="Total" v={inr(Number(sale.total))} bold />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onReprint(sale)}><Printer className="h-3.5 w-3.5 mr-1" /> Reprint</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-base border-t border-border pt-1 mt-1 col-span-2" : ""}`}>
      <span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span>
    </div>
  );
}

function EditDialog({ sale, onClose, loadItems, onSaved, userId }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [origIds, setOrigIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products", "edit-sale"],
    enabled: !!sale,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,sku,barcode,hsn_code,mrp,sale_price,gst_rate")
        .eq("is_active", true)
        .order("name")
        .limit(500);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!sale) return;
    setNotes(sale.notes ?? "");
    setDiscount(Number(sale.discount) || 0);
    loadItems(sale.id).then((rows: any[]) => {
      setItems(rows);
      setOrigIds(rows.map((r) => r.id));
    });
  }, [sale, loadItems]);

  const filteredAdd = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return [];
    return (products as any[]).filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.barcode ?? "").toLowerCase() === q ||
      (p.sku ?? "").toLowerCase() === q,
    ).slice(0, 8);
  }, [addQuery, products]);

  if (!sale) return null;

  const updateItem = (id: string, patch: any) =>
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.id !== id));

  const addProduct = (p: any) => {
    const existing = items.find((it) => it.product_id === p.id);
    if (existing) {
      updateItem(existing.id, { qty: Number(existing.qty) + 1 });
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `new-${crypto.randomUUID()}`,
        _new: true,
        sale_id: sale.id,
        product_id: p.id,
        product_name: p.name,
        hsn_code: p.hsn_code ?? null,
        qty: 1,
        price: Number(p.sale_price) || 0,
        discount: 0,
        gst_rate: Number(p.gst_rate) || 0,
        gst_amount: 0,
        total: Number(p.sale_price) || 0,
      },
    ]);
    setAddQuery("");
  };

  const recomputed = items.reduce((acc, it) => {
    const line = Number(it.qty) * Number(it.price) - Number(it.discount || 0);
    const taxable = line / (1 + Number(it.gst_rate) / 100);
    acc.sub += taxable;
    acc.gst += line - taxable;
    acc.total += line;
    return acc;
  }, { sub: 0, gst: 0, total: 0 });
  const afterBillDisc = Math.max(0, recomputed.total - discount);
  const ratio = recomputed.total > 0 ? afterBillDisc / recomputed.total : 1;

  const save = async () => {
    setSaving(true);
    try {
      // upsert lines
      for (const it of items) {
        const line = Number(it.qty) * Number(it.price) - Number(it.discount || 0);
        const taxable = line / (1 + Number(it.gst_rate) / 100);
        const payload = {
          qty: it.qty, price: it.price, discount: it.discount,
          gst_amount: line - taxable, total: line, gst_rate: it.gst_rate,
        };
        if (it._new) {
          await supabase.from("sale_items").insert({
            sale_id: sale.id, product_id: it.product_id,
            product_name: it.product_name, hsn_code: it.hsn_code,
            ...payload,
          });
          // decrement stock
          if (it.product_id) {
            const { data: prod } = await supabase.from("products").select("stock").eq("id", it.product_id).single();
            if (prod) await supabase.from("products").update({ stock: Number(prod.stock) - Number(it.qty) }).eq("id", it.product_id);
          }
        } else {
          await supabase.from("sale_items").update(payload).eq("id", it.id);
        }
      }
      // Delete removed items
      const keptIds = items.filter((i) => !i._new).map((i) => i.id);
      const removed = origIds.filter((oid) => !keptIds.includes(oid));
      for (const rid of removed) await supabase.from("sale_items").delete().eq("id", rid);

      await supabase.from("sales").update({
        subtotal: recomputed.sub * ratio,
        cgst: (recomputed.gst * ratio) / 2,
        sgst: (recomputed.gst * ratio) / 2,
        total: afterBillDisc,
        discount,
        notes,
        edited_by: userId,
      }).eq("id", sale.id);
      toast.success("Invoice updated");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit invoice <span className="font-mono">{sale.invoice_no}</span></DialogTitle>
          <p className="text-xs text-amber-600">Note: adding a product decrements its stock. Removing an existing line does NOT restore stock — use Delete invoice for full void.</p>
        </DialogHeader>
        <div className="max-h-96 overflow-auto border border-border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0">
              <tr><th className="text-left p-2">Item</th><th className="p-2 w-20">Qty</th><th className="p-2 w-24">Price</th><th className="p-2 w-20">Disc</th><th className="p-2 w-16">GST</th><th className="text-right p-2">Total</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {items.map((it: any) => {
                const line = Number(it.qty) * Number(it.price) - Number(it.discount || 0);
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="p-2">{it.product_name}{it._new && <Badge variant="secondary" className="ml-2 text-[9px]">new</Badge>}</td>
                    <td className="p-2"><Input value={it.qty} onChange={e => updateItem(it.id, { qty: Number(e.target.value) || 0 })} className="h-7 text-right font-mono" /></td>
                    <td className="p-2"><Input value={it.price} onChange={e => updateItem(it.id, { price: Number(e.target.value) || 0 })} className="h-7 text-right font-mono" /></td>
                    <td className="p-2"><Input value={it.discount} onChange={e => updateItem(it.id, { discount: Number(e.target.value) || 0 })} className="h-7 text-right font-mono" /></td>
                    <td className="p-2 text-center text-xs">{it.gst_rate}%</td>
                    <td className="p-2 text-right font-mono font-semibold">{inr(line)}</td>
                    <td><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(it.id)}><Trash2 className="h-3 w-3" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="relative">
          <Label className="text-xs text-muted-foreground">Add product</Label>
          <Input
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            placeholder="Search by name / barcode / SKU…"
          />
          {filteredAdd.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded shadow max-h-56 overflow-auto">
              {filteredAdd.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className="w-full text-left p-2 hover:bg-accent text-sm flex justify-between"
                >
                  <span>{p.name} <span className="text-xs text-muted-foreground font-mono">{p.sku ?? p.barcode ?? ""}</span></span>
                  <span className="font-mono">{inr(Number(p.sale_price))}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 items-end">
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Bill discount</Label>
            <Input value={discount} onChange={e => setDiscount(Number(e.target.value) || 0)} className="text-right font-mono" />
          </div>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <div className="text-sm text-muted-foreground">
            Original: <span className="font-mono">{inr(Number(sale.total))}</span>
            {Math.abs(afterBillDisc - Number(sale.total)) > 0.005 && (
              <span className={`ml-3 font-mono font-semibold ${afterBillDisc > Number(sale.total) ? "text-success" : "text-destructive"}`}>
                {afterBillDisc > Number(sale.total) ? "+" : "−"}{inr(Math.abs(afterBillDisc - Number(sale.total)))}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New total</div>
            <div className="font-display text-2xl font-bold">{inr(afterBillDisc)}</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

