import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ShoppingCart, Eye, Scan, Pencil, List as ListIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { inr } from "@/lib/format";
import { onEnterFocusNext } from "@/lib/keyboard-nav";
import { formatIndianDate } from "@/lib/date-format";

type Supplier = { id: string; name: string };
type Product = {
  id: string; name: string; barcode: string | null; hsn_code: string | null;
  purchase_price: number; sale_price: number; mrp: number; gst_rate: number; stock: number;
};
type PurchaseRow = {
  id: string; bill_no: string | null; supplier_name: string | null; bill_date: string;
  subtotal: number; tax_amount: number; total: number; paid: number; payment_mode: string | null;
};
type LineItem = {
  product_id: string | null; product_name: string; barcode: string; hsn_code: string;
  qty: string; cost: string; mrp: string; sale_price: string; gst_rate: string;
};

const emptyRow = (): LineItem => ({
  product_id: null, product_name: "", barcode: "", hsn_code: "",
  qty: "1", cost: "0", mrp: "0", sale_price: "0", gst_rate: "0",
});

export const Route = createFileRoute("/_app/purchases")({
  component: PurchasesPage,
});

function PurchasesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases").select("*").order("bill_date", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as PurchaseRow[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data: items } = await supabase.from("purchase_items").select("product_id, qty").eq("purchase_id", id);
      for (const it of items ?? []) {
        if (it.product_id) {
          const { data: p } = await supabase.from("products").select("stock").eq("id", it.product_id).single();
          if (p) await supabase.from("products").update({ stock: Number(p.stock) - Number(it.qty) }).eq("id", it.product_id);
          await supabase.from("stock_ledger").insert({ product_id: it.product_id, change: -Number(it.qty), reason: "purchase_void", ref_id: id });
        }
      }
      const { error } = await supabase.from("purchases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Purchase removed and stock adjusted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><ShoppingCart className="h-6 w-6" /> Purchases</h1>
          <p className="text-sm text-muted-foreground">Scan barcodes to add items. Unknown barcodes prompt quick-add. Stock auto-increases.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> New Purchase Bill</Button>
          </DialogTrigger>
          {open && <NewPurchaseDialog onClose={() => setOpen(false)} />}
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Bill #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatIndianDate(p.bill_date)}</TableCell>
                <TableCell className="font-mono text-xs">{p.bill_no || "—"}</TableCell>
                <TableCell>{p.supplier_name || "—"}</TableCell>
                <TableCell className="text-right font-mono">{inr(p.subtotal)}</TableCell>
                <TableCell className="text-right font-mono">{inr(p.tax_amount)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{inr(p.total)}</TableCell>
                <TableCell className="text-right font-mono">{inr(p.paid)}</TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" onClick={() => setViewing(p.id)}><Eye className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setEditing(p.id)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {purchases.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No purchase bills yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {viewing && <ViewPurchaseDialog id={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditPurchaseDialog id={editing} onClose={() => setEditing(null)} />}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete purchase bill?</AlertDialogTitle><AlertDialogDescription>This will permanently remove the purchase and reverse its stock impact. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={() => { if (deleteTarget) remove.mutate(deleteTarget, { onSettled: () => setDeleteTarget(null) }); }}>Delete & Reverse Stock</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewPurchaseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paid, setPaid] = useState("0");
  const [items, setItems] = useState<LineItem[]>([emptyRow()]);
  const [barcode, setBarcode] = useState("");
  const [quickAdd, setQuickAdd] = useState<{ barcode: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { barcodeRef.current?.focus(); }, []);

  // ---- Marg-style keyboard flow ----
  // Enter walks: (row) Barcode → HSN → Qty → MRP → Sale → GST% → back to the
  // scan box. Cost is skipped in this chain (still reachable/editable by
  // clicking into it directly). Arrow keys give full spreadsheet-style
  // navigation: Up/Down move between rows in the same column, Left/Right
  // move to the neighbouring column once the cursor is at the start/end of
  // the text. End saves the whole bill.
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Cost is intentionally left out of this ordered list: it's the column
  // that both Enter *and* Left/Right arrow navigation skip over, since it's
  // pre-filled from the product master and only needs a direct click to
  // change. It still has its own ref/cell (via COST_COL below) for that
  // manual click-in case.
  const COL_ORDER = ["barcode", "hsn", "qty", "cost", "mrp", "sale", "gst"] as const;
  const COST_COL = "cost" as const;
  type Col = typeof COL_ORDER[number] | typeof COST_COL;
  const NEXT_COL: Record<Col, Col | null> = {
    barcode: "hsn",
    hsn: "qty",
    qty: "cost",
    cost: "mrp",
    mrp: "sale",
    sale: "gst",
    gst: null, // end of row → loop back to the top scan box
  };
  const setCell = (idx: number, col: string) => (el: HTMLInputElement | null) => {
    cellRefs.current[`${idx}:${col}`] = el;
  };
  const focusCell = (idx: number, col: string, selectAll = true) => {
    const el = cellRefs.current[`${idx}:${col}`];
    if (!el) return false;
    el.focus();
    if (selectAll) el.select();
    return true;
  };
  const loopBackToScan = () => {
    setItems((arr) => ensureTrailingRow(arr));
    setTimeout(() => { barcodeRef.current?.focus(); barcodeRef.current?.select(); }, 30);
  };
  const cellKeyDown = (idx: number, col: Col) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (e.key === "Enter") {
      e.preventDefault();
      const next = NEXT_COL[col];
      if (next && focusCell(idx, next)) return;
      loopBackToScan();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(idx + 1, col);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx === 0) { barcodeRef.current?.focus(); barcodeRef.current?.select(); return; }
      focusCell(idx - 1, col);
      return;
    }
    if (e.key === "ArrowLeft" && input.selectionStart === 0 && input.selectionEnd === 0) {
      const pos = COL_ORDER.indexOf(col);
      const prev = COL_ORDER[pos - 1];
      if (prev) { e.preventDefault(); focusCell(idx, prev, false); }
      return;
    }
    if (
      e.key === "ArrowRight" &&
      input.selectionStart === input.value.length &&
      input.selectionEnd === input.value.length
    ) {
      const pos = COL_ORDER.indexOf(col);
      const next = COL_ORDER[pos + 1];
      if (next) { e.preventDefault(); focusCell(idx, next, false); }
      return;
    }
  };
  const focusRowCell = (idx: number, col: string) => {
    setTimeout(() => { focusCell(idx, col); }, 30);
  };


  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name").order("name");
      return (data ?? []) as Supplier[];
    },
  });
  const { data: products = [], refetch: refetchProducts } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data } = await supabase.from("products")
        .select("id,name,barcode,hsn_code,purchase_price,sale_price,mrp,gst_rate,stock").order("name");
      return (data ?? []) as Product[];
    },
  });

  const totals = useMemo(() => {
    let subtotal = 0, tax = 0;
    for (const i of items) {
      const q = Number(i.qty) || 0, c = Number(i.cost) || 0, g = Number(i.gst_rate) || 0;
      const line = q * c;
      subtotal += line;
      tax += (line * g) / 100;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [items]);

  const upd = (idx: number, patch: Partial<LineItem>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const ensureTrailingRow = (arr: LineItem[]): LineItem[] => {
    const last = arr[arr.length - 1];
    if (!last || last.product_id || last.product_name) return [...arr, emptyRow()];
    return arr;
  };

  const addProductLine = (p: Product): number => {
    let resultIdx = -1;
    setItems((arr) => {
      // increment qty if same product already present
      const existingIdx = arr.findIndex((it) => it.product_id === p.id);
      if (existingIdx >= 0) {
        resultIdx = existingIdx;
        const next = arr.map((it, i) =>
          i === existingIdx ? { ...it, qty: String((Number(it.qty) || 0) + 1) } : it,
        );
        return ensureTrailingRow(next);
      }
      // replace first empty row, else append
      const blankIdx = arr.findIndex((it) => !it.product_id && !it.product_name);
      const row: LineItem = {
        product_id: p.id, product_name: p.name, barcode: p.barcode ?? "",
        hsn_code: p.hsn_code ?? "", qty: "1",
        cost: String(Number(p.purchase_price) || 0),
        mrp: String(Number(p.mrp) || 0),
        sale_price: String(Number(p.sale_price) || 0),
        gst_rate: String(Number(p.gst_rate) || 0),
      };
      resultIdx = blankIdx >= 0 ? blankIdx : arr.length;
      const next = blankIdx >= 0
        ? arr.map((it, i) => (i === blankIdx ? row : it))
        : [...arr, row];
      return ensureTrailingRow(next);
    });
    return resultIdx;
  };

  const handleBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const p = products.find((x) => (x.barcode || "").trim() === trimmed);
    if (p) {
      const idx = addProductLine(p);
      setBarcode("");
      // HSN first, then Qty, then Enter loops back to the barcode box —
      // see cellKeyDown above.
      if (idx >= 0) focusRowCell(idx, "hsn"); else barcodeRef.current?.focus();
      return;
    }
    setQuickAdd({ barcode: trimmed });
    setBarcode("");
  };

  const save = useMutation({
    mutationFn: async () => {
      const validItems = items.filter((i) => i.product_name && (Number(i.qty) || 0) > 0);
      if (validItems.length === 0) throw new Error("Add at least one item");

      const supplier = suppliers.find((s) => s.id === supplierId);
      const { data: purch, error: e1 } = await supabase.from("purchases").insert({
        bill_no: billNo || null, bill_date: billDate,
        supplier_id: supplierId || null, supplier_name: supplier?.name || null,
        subtotal: totals.subtotal, tax_amount: totals.tax, total: totals.total,
        paid: Number(paid) || 0, payment_mode: paymentMode,
      }).select().single();
      if (e1) throw e1;

      const itemRows = validItems.map((i) => {
        const q = Number(i.qty), c = Number(i.cost), g = Number(i.gst_rate);
        const line = q * c;
        const gstAmt = (line * g) / 100;
        return {
          purchase_id: purch.id, product_id: i.product_id, product_name: i.product_name, barcode: i.barcode || null,
          hsn_code: i.hsn_code || null, qty: q, cost: c, mrp: Number(i.mrp)||0, sale_price: Number(i.sale_price)||0, gst_rate: g,
          gst_amount: gstAmt, total: line + gstAmt,
        };
      });
      const { error: e2 } = await supabase.from("purchase_items").insert(itemRows);
      if (e2) throw e2;

      // Aggregate qty per product to avoid stale-stock overwrites when the
      // same product appears in multiple rows.
      const byProduct = new Map<string, { qty: number; cost: number; mrp: number; sale: number }>();
      for (const i of validItems) {
        if (!i.product_id) continue;
        const q = Number(i.qty) || 0, c = Number(i.cost) || 0;
        const m = Number(i.mrp) || 0, sp = Number(i.sale_price) || 0;
        const cur = byProduct.get(i.product_id) ?? { qty: 0, cost: c, mrp: m, sale: sp };
        cur.qty += q;
        cur.cost = c; // last cost wins
        if (m > 0) cur.mrp = m;
        if (sp > 0) cur.sale = sp;
        byProduct.set(i.product_id, cur);
      }
      for (const [pid, agg] of byProduct) {
        // Re-fetch latest stock/prices right before update.
        const { data: fresh } = await supabase
          .from("products").select("stock,mrp,sale_price").eq("id", pid).single();
        const newStock = Number(fresh?.stock ?? 0) + agg.qty;
        const patch: any = { stock: newStock, purchase_price: agg.cost };

        const baseMrp = Number(fresh?.mrp ?? 0);
        const baseSale = Number(fresh?.sale_price ?? 0);

        if (agg.mrp > 0 && baseMrp > 0 && Math.abs(agg.mrp - baseMrp) > 0.001) {
          // Different MRP for the same product -> keep both as sellable variants
          // instead of overwriting, so POS can ask which price to bill.
          const { data: existing } = await supabase
            .from("product_variants").select("id,mrp").eq("product_id", pid);
          const has = (existing ?? []).some((v: any) => Math.abs(Number(v.mrp) - agg.mrp) < 0.001);
          if (!has) {
            await supabase.from("product_variants").insert({
              product_id: pid,
              label: `MRP ${agg.mrp}`,
              mrp: agg.mrp,
              sale_price: agg.sale > 0 ? agg.sale : agg.mrp,
              purchase_price: agg.cost,
            });
          }
        } else {
          if (agg.mrp > 0) patch.mrp = agg.mrp;
          if (agg.sale > 0) patch.sale_price = agg.sale;
        }
        if (!baseMrp && agg.mrp > 0) patch.mrp = agg.mrp;
        if (!baseSale && agg.sale > 0) patch.sale_price = agg.sale;

        await supabase.from("products").update(patch).eq("id", pid);
        await supabase.from("stock_ledger").insert({
          product_id: pid, change: agg.qty, reason: "purchase", ref_id: purch.id,
        });
      }

    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Purchase saved · Stock updated");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <DialogContent
        className="max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "End" && !save.isPending) { e.preventDefault(); save.mutate(); }
          if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "I")) {
            e.preventDefault();
            setPickerOpen(true);
          }
        }}
      >
        <DialogHeader><DialogTitle>New Purchase Bill</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 overscroll-contain">


        <div className="grid gap-3 sm:grid-cols-4" data-enter-nav onKeyDown={onEnterFocusNext}>
          <div><Label>Bill No.</Label><Input autoFocus value={billNo} onChange={(e) => setBillNo(e.target.value)} /></div>
          <div><Label>Date</Label><Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Supplier</Label>
            <Select
              value={supplierId}
              onValueChange={(v) => {
                setSupplierId(v);
                setTimeout(() => { barcodeRef.current?.focus(); barcodeRef.current?.select(); }, 30);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs uppercase tracking-wide flex items-center gap-1"><Scan className="h-3.5 w-3.5" /> Scan / Enter Barcode</Label>
            <Button type="button" variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => setPickerOpen(true)}>
              <ListIcon className="h-3 w-3 mr-1" /> All items (Ctrl+I)
            </Button>
          </div>
          <Input
            ref={barcodeRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleBarcode(barcode); }
              else if (e.key === "ArrowDown") { e.preventDefault(); focusCell(0, "barcode"); }
            }}
            placeholder="Scan barcode and press Enter, or press Ctrl+I to pick from all items"
            className="mt-1 font-mono"
          />
        </div>

        <div className="border rounded-md overflow-x-auto mt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24%]">Product</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="w-16">Qty</TableHead>
                <TableHead className="w-20">Cost</TableHead>
                <TableHead className="w-20">MRP</TableHead>
                <TableHead className="w-20">Sale ₹</TableHead>
                <TableHead className="w-16">GST%</TableHead>
                <TableHead className="text-right">Line</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i, idx) => {
                const q = Number(i.qty) || 0, c = Number(i.cost) || 0, g = Number(i.gst_rate) || 0;
                const line = q * c * (1 + g / 100);
                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select
                        value={i.product_id ?? ""}
                        onValueChange={(v) => {
                          const p = products.find((x) => x.id === v);
                          if (p) {
                            upd(idx, {
                              product_id: p.id, product_name: p.name, barcode: p.barcode ?? "",
                              hsn_code: p.hsn_code ?? "",
                              cost: String(Number(p.purchase_price) || 0),
                              mrp: String(Number(p.mrp) || 0),
                              sale_price: String(Number(p.sale_price) || 0),
                              gst_rate: String(Number(p.gst_rate) || 0),
                            });
                            setItems((arr) => ensureTrailingRow(arr));
                            focusRowCell(idx, "hsn");
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder={i.product_name || "Pick product"} /></SelectTrigger>
                        <SelectContent>
                          {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input ref={setCell(idx, "barcode")} onKeyDown={cellKeyDown(idx, "barcode")} className="font-mono text-xs" value={i.barcode} onChange={(e) => upd(idx, { barcode: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "hsn")} onKeyDown={cellKeyDown(idx, "hsn")} value={i.hsn_code} onChange={(e) => upd(idx, { hsn_code: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "qty")} onKeyDown={cellKeyDown(idx, "qty")} inputMode="decimal" value={i.qty} onChange={(e) => upd(idx, { qty: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "cost")} onKeyDown={cellKeyDown(idx, "cost")} inputMode="decimal" value={i.cost} onChange={(e) => upd(idx, { cost: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "mrp")} onKeyDown={cellKeyDown(idx, "mrp")} inputMode="decimal" value={i.mrp} onChange={(e) => upd(idx, { mrp: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "sale")} onKeyDown={cellKeyDown(idx, "sale")} inputMode="decimal" value={i.sale_price} onChange={(e) => upd(idx, { sale_price: e.target.value })} /></TableCell>
                    <TableCell><Input ref={setCell(idx, "gst")} onKeyDown={cellKeyDown(idx, "gst")} inputMode="decimal" value={i.gst_rate} onChange={(e) => upd(idx, { gst_rate: e.target.value })} /></TableCell>

                    <TableCell className="text-right font-mono">{inr(line)}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setItems((a) => {
                        const next = a.filter((_, k) => k !== idx);
                        return next.length === 0 ? [emptyRow()] : next;
                      })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" size="sm" onClick={() => setItems((a) => [...a, emptyRow()])}>
          <Plus className="h-4 w-4 mr-1" /> Add Row
        </Button>

        <div className="grid sm:grid-cols-3 gap-3 mt-2">
          <div>
            <Label>Payment Mode</Label>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank">Bank</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="Credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Paid</Label><Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
          <div className="rounded-md border p-3 bg-muted/30">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-mono">{inr(totals.subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span>Tax</span><span className="font-mono">{inr(totals.tax)}</span></div>
            <div className="flex justify-between font-bold mt-1"><span>Total</span><span className="font-mono">{inr(totals.total)}</span></div>
          </div>
        </div>
        </div>

        <DialogFooter className="sm:justify-between border-t pt-3 mt-1 shrink-0 bg-background">

          <div className="text-xs text-muted-foreground self-center">
            Enter: Barcode→HSN→Qty→MRP→Sale→GST%→back to scan · ↑↓←→ move between cells · Ctrl+I = pick from all items · End = Save Purchase
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save Purchase</Button>
          </div>
        </DialogFooter>

      </DialogContent>

      {quickAdd && (
        <QuickAddProductDialog
          barcode={quickAdd.barcode}
          onClose={() => { setQuickAdd(null); barcodeRef.current?.focus(); }}
          onCreated={async (newId) => {
            const { data } = await refetchProducts();
            const p = (data ?? []).find((x) => x.id === newId);
            if (p) {
              const idx = addProductLine(p);
              setQuickAdd(null);
              if (idx >= 0) focusRowCell(idx, "hsn"); else barcodeRef.current?.focus();
            } else {
              setQuickAdd(null);
              barcodeRef.current?.focus();
            }
          }}
        />
      )}

      <ProductPickerDialog
        open={pickerOpen}
        products={products}
        onClose={() => { setPickerOpen(false); barcodeRef.current?.focus(); }}
        onPick={(p) => {
          const idx = addProductLine(p);
          setPickerOpen(false);
          if (idx >= 0) focusRowCell(idx, "hsn"); else barcodeRef.current?.focus();
        }}
      />
    </>
  );
}

function QuickAddProductDialog({
  barcode, onClose, onCreated,
}: { barcode: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [hsn, setHsn] = useState("");
  const [cost, setCost] = useState("0");
  const [sale, setSale] = useState("0");
  const [mrp, setMrp] = useState("0");
  const [gst, setGst] = useState("0");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("Product name required");
    setSaving(true);
    const { data, error } = await supabase.from("products").insert({
      name: name.trim(), barcode, hsn_code: hsn || null,
      purchase_price: Number(cost) || 0,
      sale_price: Number(sale) || Number(cost) || 0,
      mrp: Number(mrp) || Number(sale) || 0,
      gst_rate: Number(gst) || 0,
      stock: 0, is_active: true,
    }).select("id").single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Product added");
    onCreated(data.id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Add Product</DialogTitle>
          <p className="text-xs text-muted-foreground">New barcode <span className="font-mono">{barcode}</span> — fill details to add to inventory.</p>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2" data-enter-nav onKeyDown={onEnterFocusNext}>
          <div className="sm:col-span-2"><Label>Name *</Label><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>HSN</Label><Input value={hsn} onChange={(e) => setHsn(e.target.value)} /></div>
          <div><Label>GST %</Label><Input inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} /></div>
          <div><Label>Purchase Cost</Label><Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div><Label>Sale Price</Label><Input inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} /></div>
          <div>
            <Label>MRP</Label>
            <Input
              inputMode="decimal"
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !saving) { e.preventDefault(); save(); } }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Add & Continue"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "All items" picker — opened via the Ctrl+I shortcut or its button next to
// the barcode box, for adding a line without a scanner (or when a product
// has no barcode). Arrow keys move the highlighted row, Enter picks it.
function ProductPickerDialog({
  open, products, onClose, onPick,
}: { open: boolean; products: Product[]; onClose: () => void; onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products.slice(0, 200);
    return products.filter((p) =>
      p.name.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term),
    ).slice(0, 200);
  }, [q, products]);

  useEffect(() => {
    if (open) {
      setQ("");
      setHi(0);
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>All items</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or barcode…"
            className="pl-8"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); const p = filtered[hi]; if (p) onPick(p); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
          />
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto border rounded-md divide-y">
          {filtered.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">No items match "{q}"</div>
          )}
          {filtered.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              data-idx={idx}
              onMouseEnter={() => setHi(idx)}
              onClick={() => onPick(p)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${idx === hi ? "bg-accent" : ""}`}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-xs font-mono text-muted-foreground shrink-0">{p.barcode || "—"}</span>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">↑↓ to move · Enter to add · Esc to close</div>
      </DialogContent>
    </Dialog>
  );
}

function ViewPurchaseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["purchase", id],
    queryFn: async () => {
      const { data: head } = await supabase.from("purchases").select("*").eq("id", id).single();
      const { data: items } = await supabase.from("purchase_items").select("*").eq("purchase_id", id);
      return { head, items: items ?? [] };
    },
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Purchase Bill {data?.head?.bill_no}</DialogTitle></DialogHeader>
        {data?.head && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><b>Supplier:</b> {data.head.supplier_name}</div>
              <div><b>Date:</b> {formatIndianDate(data.head.bill_date)}</div>
              <div><b>Payment:</b> {data.head.payment_mode} · Paid {inr(data.head.paid)}</div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Cost</TableHead><TableHead>GST</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.items.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.product_name}</TableCell>
                    <TableCell>{i.qty}</TableCell>
                    <TableCell>{inr(i.cost)}</TableCell>
                    <TableCell>{i.gst_rate}%</TableCell>
                    <TableCell className="text-right font-mono">{inr(i.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-6 pt-2 border-t">
              <div>Subtotal: <b className="font-mono">{inr(data.head.subtotal)}</b></div>
              <div>Tax: <b className="font-mono">{inr(data.head.tax_amount)}</b></div>
              <div>Total: <b className="font-mono">{inr(data.head.total)}</b></div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditPurchaseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  // Catch Ctrl+I at window level as well as the dialog, so Chromium/Electron or
  // an input cannot swallow the shortcut. It is scoped to this edit dialog.
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault(); e.stopPropagation(); setPickerOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut, true);
    return () => window.removeEventListener("keydown", onShortcut, true);
  }, []);

  const qc = useQueryClient();
  const [items, setItems] = useState<LineItem[]>([]);
  const [head, setHead] = useState<any>(null);
  const [originalTotal, setOriginalTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paid, setPaid] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [quickAdd, setQuickAdd] = useState<{ barcode: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const COLS = ["barcode", "hsn", "qty", "cost", "mrp", "sale", "gst"] as const;
  const focusCell = (i: number, col: string) => { const el = cellRefs.current[`${i}:${col}`]; if (el) { el.focus(); el.select(); } };
  const setCell = (i: number, col: string) => (el: HTMLInputElement | null) => { cellRefs.current[`${i}:${col}`] = el; };
  const nextCol = (col: string) => COLS[COLS.indexOf(col as any) + 1];

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-list"], queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name").order("name"); return (data ?? []) as Supplier[];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-list"], staleTime: 60_000, queryFn: async () => {
      const { data } = await supabase.from("products").select("id,name,barcode,hsn_code,purchase_price,sale_price,mrp,gst_rate,stock").order("name");
      return (data ?? []) as Product[];
    },
  });

  useEffect(() => {
    (async () => {
      const [hr, ir] = await Promise.all([
        supabase.from("purchases").select("*").eq("id", id).single(),
        supabase.from("purchase_items").select("*").eq("purchase_id", id),
      ]);
      const h = hr.data, its = ir.data;
      if (hr.error) { toast.error(hr.error.message); return; }
      if (ir.error) { toast.error(ir.error.message); return; }
      const ids = Array.from(new Set((its ?? []).map((r:any)=>r.product_id).filter(Boolean)));
      const { data: masters } = ids.length ? await supabase.from("products").select("id,barcode,hsn_code,purchase_price,sale_price,mrp,gst_rate").in("id", ids) : { data: [] as any[] };
      const masterMap = new Map((masters ?? []).map((m:any)=>[m.id,m]));
      setHead(h); setOriginalTotal(Number(h?.total ?? 0)); setBillNo(h?.bill_no ?? ""); setBillDate(h?.bill_date ?? "");
      setSupplierId(h?.supplier_id ?? ""); setPaymentMode(h?.payment_mode ?? "Cash"); setPaid(String(h?.paid ?? 0));
      setItems((its ?? []).map((r: any) => {
        const m:any=masterMap.get(r.product_id) || {};
        const storedGst=Number(r.gst_rate);
        const masterGst=Number(m.gst_rate);
        const storedCost=Number(r.cost);
        const masterCost=Number(m.purchase_price);
        return {
          product_id:r.product_id, product_name:r.product_name ?? "",
          barcode:r.barcode ?? m.barcode ?? "", hsn_code:r.hsn_code ?? m.hsn_code ?? "",
          qty:String(r.qty ?? 1),
          cost:String(Number.isFinite(storedCost) && storedCost > 0 ? storedCost : (masterCost || 0)),
          mrp:String(Number(r.mrp) > 0 ? r.mrp : (Number(m.mrp) || 0)),
          sale_price:String(Number(r.sale_price) > 0 ? r.sale_price : (Number(m.sale_price) || 0)),
          // Older purchase rows may contain the default 0 even though the product
          // master has a GST rate. Show that useful rate while loading the edit.
          gst_rate:String(Number.isFinite(storedGst) && storedGst > 0 ? storedGst : (masterGst || 0)),
        };
      }));
      setTimeout(() => barcodeRef.current?.focus(), 80);
    })();
  }, [id]);

  const upd = (idx:number, patch:Partial<LineItem>) => setItems(a => a.map((x,i)=>i===idx?{...x,...patch}:x));
  const remove = (idx:number) => setItems(a => a.filter((_,i)=>i!==idx));
  const addProduct = (p: Product) => {
    const existing = items.findIndex(x => x.product_id === p.id);
    if (existing >= 0) { upd(existing,{qty:String((Number(items[existing].qty)||0)+1)}); focusCell(existing,"qty"); return; }
    const row:LineItem={product_id:p.id,product_name:p.name,barcode:p.barcode??"",hsn_code:p.hsn_code??"",qty:"1",cost:String(p.purchase_price||0),mrp:String(p.mrp||0),sale_price:String(p.sale_price||0),gst_rate:String(p.gst_rate||0)};
    const nextIndex = items.length; setItems(a=>[...a,row]); setTimeout(()=>focusCell(nextIndex,"hsn"),40);
  };
  const handleBarcode = (value:string) => {
    const q=value.trim(); if(!q)return;
    const p=products.find(x=>(x.barcode??"").trim().toLowerCase()===q.toLowerCase() || x.name.toLowerCase()===q.toLowerCase());
    if(p){ addProduct(p); setBarcode(""); return; }
    setQuickAdd({barcode:q}); setBarcode("");
  };
  const totals=useMemo(()=>items.reduce((a,i)=>{const q=Number(i.qty)||0,c=Number(i.cost)||0,g=Number(i.gst_rate)||0;const line=q*c;a.sub+=line;a.tax+=line*g/100;return a},{sub:0,tax:0}),[items]);
  const total=totals.sub+totals.tax; const diff=total-originalTotal;

  const save=async()=>{setSaving(true);try{
    const valid=items.filter(i=>i.product_name&&Number(i.qty)>0); if(!valid.length)throw new Error("Add at least one item");
    const {data:oldItems}=await supabase.from("purchase_items").select("*").eq("purchase_id",id);
    for(const oi of oldItems??[]){if(!oi.product_id)continue;const qty=Number(oi.qty)||0;const {data:p}=await supabase.from("products").select("stock").eq("id",oi.product_id).single();if(p)await supabase.from("products").update({stock:Number(p.stock)-qty}).eq("id",oi.product_id);if(qty)await supabase.from("stock_ledger").insert({product_id:oi.product_id,change:-qty,reason:"purchase_edit",ref_id:id});}
    await supabase.from("purchase_items").delete().eq("purchase_id",id);
    const rows=valid.map(i=>{const q=Number(i.qty),c=Number(i.cost),g=Number(i.gst_rate),line=q*c;return {purchase_id:id,product_id:i.product_id,product_name:i.product_name,barcode:i.barcode||null,hsn_code:i.hsn_code||null,qty:q,cost:c,mrp:Number(i.mrp)||0,sale_price:Number(i.sale_price)||0,gst_rate:g,gst_amount:line*g/100,total:line*(1+g/100)};});
    const {error:ie}=await supabase.from("purchase_items").insert(rows);if(ie)throw ie;
    for(const i of valid){if(!i.product_id)continue;const qty=Number(i.qty)||0;const {data:p}=await supabase.from("products").select("stock").eq("id",i.product_id).single();if(p)await supabase.from("products").update({stock:Number(p.stock)+qty,purchase_price:Number(i.cost)||0,mrp:Number(i.mrp)||p.mrp,sale_price:Number(i.sale_price)||p.sale_price}).eq("id",i.product_id);if(qty)await supabase.from("stock_ledger").insert({product_id:i.product_id,change:qty,reason:"purchase_edit",ref_id:id});}
    const supplier=suppliers.find(s=>s.id===supplierId);
    const {error:e}=await supabase.from("purchases").update({bill_no:billNo||null,bill_date:billDate,supplier_id:supplierId||null,supplier_name:supplier?.name||null,subtotal:totals.sub,tax_amount:totals.tax,total,paid:Number(paid)||0,payment_mode:paymentMode}).eq("id",id);if(e)throw e;
    toast.success(`Purchase updated · Difference ${diff>=0?"+":"−"}${inr(Math.abs(diff))}`);qc.invalidateQueries();onClose();
  }catch(e:any){toast.error(e.message??"Failed to update purchase")}finally{setSaving(false)}};

  if(!head)return <Dialog open onOpenChange={onClose}><DialogContent>Loading…</DialogContent></Dialog>;
  return <Dialog open onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onKeyDown={e=>{if(e.key==="End"&&!saving){e.preventDefault();void save();} if((e.ctrlKey||e.metaKey)&&(e.key==="i"||e.key==="I")){e.preventDefault();setPickerOpen(true);}}}>
    <DialogHeader><DialogTitle>Edit Purchase Bill <span className="font-mono">{billNo}</span></DialogTitle></DialogHeader>
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid gap-3 sm:grid-cols-4" data-enter-nav onKeyDown={onEnterFocusNext}>
        <div><Label>Bill No.</Label><Input autoFocus value={billNo} onChange={e=>setBillNo(e.target.value)}/></div>
        <div><Label>Date</Label><Input type="date" value={billDate} onChange={e=>setBillDate(e.target.value)}/></div>
        <div className="sm:col-span-2"><Label>Supplier</Label><Select value={supplierId||"none"} onValueChange={v=>{setSupplierId(v==="none"?"":v);setTimeout(()=>barcodeRef.current?.focus(),30)}}><SelectTrigger><SelectValue placeholder="Select supplier"/></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{suppliers.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><Label className="text-xs uppercase tracking-wide flex items-center gap-1"><Scan className="h-3.5 w-3.5"/> Scan / Enter Barcode</Label><Button type="button" variant="outline" size="sm" className="h-6 text-xs px-2" onClick={()=>setPickerOpen(true)}>All items</Button></div><Input ref={barcodeRef} value={barcode} onChange={e=>setBarcode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();handleBarcode(barcode)}}} placeholder="Scan barcode and press Enter" className="mt-1 font-mono"/></div>
      <div className="border rounded-md overflow-x-auto mt-3"><Table><TableHeader><TableRow><TableHead className="w-[24%]">Product</TableHead><TableHead>Barcode</TableHead><TableHead>HSN</TableHead><TableHead>Qty</TableHead><TableHead>Cost</TableHead><TableHead>MRP</TableHead><TableHead>Sale ₹</TableHead><TableHead>GST%</TableHead><TableHead className="text-right">Amount</TableHead><TableHead/></TableRow></TableHeader><TableBody>{items.map((i,idx)=>{const q=Number(i.qty)||0,c=Number(i.cost)||0,g=Number(i.gst_rate)||0;return <TableRow key={`${i.product_id}-${idx}`}><TableCell className="font-medium">{i.product_name}</TableCell>{(["barcode","hsn","qty","cost","mrp","sale","gst"] as const).map(col=><TableCell key={col}><Input ref={setCell(idx,col)} value={(i as any)[col==="sale"?"sale_price":col]} onChange={e=>upd(idx,{[col==="sale"?"sale_price":col]:e.target.value} as any)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();const n=nextCol(col);if(n)focusCell(idx,n);else if(idx<items.length-1)focusCell(idx+1,"barcode");else{barcodeRef.current?.focus();barcodeRef.current?.select()}}}} className="h-7 text-xs"/></TableCell>)}<TableCell className="text-right font-mono">{inr(q*c*(1+g/100))}</TableCell><TableCell><Button size="icon" variant="ghost" onClick={()=>remove(idx)}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell></TableRow>})}</TableBody></Table></div>
      <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={()=>setItems(a=>[...a,emptyRow()])}><Plus className="h-4 w-4 mr-1"/> Add Row</Button>
      <div className="grid sm:grid-cols-3 gap-3 mt-3"><div><Label>Payment Mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Bank">Bank</SelectItem><SelectItem value="UPI">UPI</SelectItem><SelectItem value="Credit">Credit</SelectItem></SelectContent></Select></div><div><Label>Paid</Label><Input inputMode="decimal" value={paid} onChange={e=>setPaid(e.target.value)}/></div><div className="rounded-md border p-3 bg-muted/30"><div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-mono">{inr(totals.sub)}</span></div><div className="flex justify-between text-sm"><span>Tax</span><span className="font-mono">{inr(totals.tax)}</span></div><div className="flex justify-between font-bold mt-1"><span>New Total</span><span className="font-mono">{inr(total)}</span></div><div className={`flex justify-between text-sm mt-1 font-semibold ${diff===0?"text-muted-foreground":diff>0?"text-destructive":"text-emerald-600"}`}><span>Amount Difference</span><span className="font-mono">{diff>=0?"+":"−"}{inr(Math.abs(diff))}</span></div></div></div>
    </div>
    <DialogFooter className="sm:justify-between border-t pt-3 mt-1 shrink-0 bg-background"><div className="text-xs text-muted-foreground">Enter: Barcode → HSN → Qty → Cost → MRP → Sale → GST% · Ctrl+I = all products · End = Save</div><div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving?"Saving…":"Save Changes"}</Button></div></DialogFooter>
  </DialogContent>
  {quickAdd && <QuickAddProductDialog barcode={quickAdd.barcode} onClose={()=>{setQuickAdd(null);setTimeout(()=>barcodeRef.current?.focus(),30)}} onCreated={async(newId)=>{const {data}=await supabase.from("products").select("id,name,barcode,hsn_code,purchase_price,sale_price,mrp,gst_rate,stock").eq("id",newId).single(); if(data){addProduct(data as Product); setQuickAdd(null); setTimeout(()=>barcodeRef.current?.focus(),60);} else setQuickAdd(null);}} />}
  <ProductPickerDialog open={pickerOpen} products={products} onClose={()=>{setPickerOpen(false);setTimeout(()=>barcodeRef.current?.focus(),30)}} onPick={p=>{addProduct(p);setPickerOpen(false);setTimeout(()=>barcodeRef.current?.focus(),60)}} />
  </Dialog>;
}

