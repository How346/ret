import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Search, AlertTriangle, Upload, Download, Tags, Loader2, Trash2, Printer, Image as ImageIcon, Layers, History as HistoryIcon, Eye } from "lucide-react";
import { inr, num } from "@/lib/format";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildFixedLabelJob, printTsplDirect, type FixedLabel } from "@/lib/tspl";
import { useStoreSettings } from "@/hooks/use-store-settings";
import { onEnterFocusNext } from "@/lib/keyboard-nav";

export const Route = createFileRoute("/_app/products")({
  component: ProductsPage,
});

type Product = {
  id: string; name: string; sku: string | null; barcode: string | null;
  hsn_code: string | null; unit: string; mrp: number; sale_price: number;
  wholesale_price: number; purchase_price: number; gst_rate: number;
  stock: number; low_stock_alert: number; is_active: boolean;
  category_id: string | null; image_url?: string | null;
};

function emptyProduct(): Partial<Product> {
  return { name: "", sku: "", barcode: "", hsn_code: "", unit: "PCS",
    mrp: 0, sale_price: 0, wholesale_price: 0, purchase_price: 0,
    gst_rate: 18, stock: 0, low_stock_alert: 5, is_active: true, image_url: "" };
}


function ProductsPage() {
  const qc = useQueryClient();
  const { data: settings } = useStoreSettings();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelOpen, setLabelOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id,name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const filtered = products.filter(p => {
    const s = q.toLowerCase();
    return !s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.barcode?.toLowerCase().includes(s);
  });

  const lowStock = products.filter(p => p.stock <= p.low_stock_alert).length;

  const save = async () => {
    if (!editing?.name) return toast.error("Name required");
    const payload: any = { ...editing };
    if (!payload.sku) payload.sku = null;
    if (!payload.barcode) payload.barcode = null;
    if (!payload.category_id) payload.category_id = null;
    if (!payload.image_url) payload.image_url = null;

    const { error } = editing.id
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["products"] });
    setEditing(null);
  };

  const remove = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const toggleSel = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
  };

  // ---- CSV import ----
  const onCsvFile = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return toast.error("CSV must include a header + data rows");
    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      if (cells.every(c => !c.trim())) continue;
      const obj: any = {};
      header.forEach((h, idx) => { obj[h] = cells[idx]?.trim() ?? ""; });
      const row: any = {
        name: obj.name || obj.product_name || obj.item,
        sku: obj.sku || null,
        barcode: obj.barcode || null,
        hsn_code: obj.hsn_code || obj.hsn || null,
        unit: obj.unit || "PCS",
        mrp: Number(obj.mrp) || 0,
        sale_price: Number(obj.sale_price ?? obj.price) || 0,
        wholesale_price: Number(obj.wholesale_price) || 0,
        purchase_price: Number(obj.purchase_price ?? obj.cost) || 0,
        gst_rate: Number(obj.gst_rate ?? obj.gst) || 0,
        stock: Number(obj.stock ?? obj.opening_stock) || 0,
        low_stock_alert: Number(obj.low_stock_alert) || 5,
        is_active: true,
      };
      if (!row.name) continue;
      rows.push(row);
    }
    if (rows.length === 0) return toast.error("No valid rows found");
    const { error } = await supabase.from("products").insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`Imported ${rows.length} products`);
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const downloadCsvTemplate = () => {
    const csv = "name,sku,barcode,hsn_code,unit,mrp,sale_price,wholesale_price,purchase_price,gst_rate,stock,low_stock_alert\nExample Product,SKU001,8901234567890,1234,PCS,120,100,90,80,18,50,5\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "products-template.csv";
    a.click();
  };

  const exportCsv = () => {
    const header = "name,sku,barcode,hsn_code,unit,mrp,sale_price,wholesale_price,purchase_price,gst_rate,stock,low_stock_alert\n";
    const body = products.map(p => [
      csvEsc(p.name), csvEsc(p.sku), csvEsc(p.barcode), csvEsc(p.hsn_code), csvEsc(p.unit),
      p.mrp, p.sale_price, p.wholesale_price, p.purchase_price, p.gst_rate, p.stock, p.low_stock_alert,
    ].join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "products.csv";
    a.click();
  };

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col p-4 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">{products.length} items · {lowStock} low stock · {selected.size} selected</p>
        </div>
        <div className="flex-1" />
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, SKU, barcode" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
        </div>
        <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={e => {
          const f = e.target.files?.[0]; if (f) onCsvFile(f); e.target.value = "";
        }} />
        <Button variant="outline" onClick={() => csvRef.current?.click()}><Upload className="h-4 w-4 mr-1" /> Import CSV</Button>
        <Button variant="ghost" size="sm" onClick={downloadCsvTemplate} title="Download CSV template"><Download className="h-4 w-4" /></Button>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export</Button>
        <Button variant="outline" disabled={selected.size === 0} onClick={() => setLabelOpen(true)}>
          <Tags className="h-4 w-4 mr-1" /> Print Labels ({selected.size})
        </Button>
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(emptyProduct())}><Plus className="h-4 w-4 mr-1" />New product</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing?.id ? "Edit product" : "New product"}</DialogTitle></DialogHeader>
            <div data-enter-nav onKeyDown={onEnterFocusNext}>
              {editing && <ProductForm value={editing} onChange={setEditing} categories={categories} />}
              {editing?.id && (
                <>
                  <VariantsEditor productId={editing.id} />
                  <PurchaseHistory productId={editing.id} />
                </>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={save}>Save</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

      </div>

      <Card className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-xs text-muted-foreground">
                <th className="w-8 px-3"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                <th className="text-left font-medium py-2 px-1">Name</th>
                <th className="text-left font-medium py-2">SKU / Barcode</th>
                <th className="text-left font-medium py-2">HSN</th>
                <th className="text-right font-medium py-2">MRP</th>
                <th className="text-right font-medium py-2">Sale</th>
                <th className="text-right font-medium py-2">Stock</th>
                <th className="text-right font-medium py-2">GST%</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3"><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSel(p.id)} /></td>
                  <td className="py-2 px-1 font-medium">{p.name}</td>
                  <td className="py-2 font-mono text-xs">{p.sku ?? "—"}<br /><span className="text-muted-foreground">{p.barcode ?? ""}</span></td>
                  <td className="py-2 font-mono text-xs">{p.hsn_code ?? "—"}</td>
                  <td className="py-2 text-right font-mono">{inr(p.mrp)}</td>
                  <td className="py-2 text-right font-mono font-semibold">{inr(p.sale_price)}</td>
                  <td className="py-2 text-right">
                    {p.stock <= p.low_stock_alert ? (
                      <Badge variant="destructive" className="font-mono"><AlertTriangle className="h-3 w-3 mr-1" />{num(p.stock, 0)}</Badge>
                    ) : <span className="font-mono">{num(p.stock, 0)} {p.unit}</span>}
                  </td>
                  <td className="py-2 text-right font-mono">{p.gst_rate}%</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="View details" onClick={() => setViewing(p)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditing(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete" onClick={() => remove(p)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No products yet — click "New product" or "Import CSV".</td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </Card>

      <LabelDialog
        open={labelOpen} onClose={() => setLabelOpen(false)}
        items={products.filter(p => selected.has(p.id))}
        shopName={settings?.shop_name ?? ""}
      />

      <ViewProductDialog
        product={viewing}
        onClose={() => setViewing(null)}
        onEdit={(p) => { setViewing(null); setEditing(p); }}
      />
    </div>
  );
}

function ViewProductDialog({ product, onClose, onEdit }: {
  product: Product | null; onClose: () => void; onEdit: (p: Product) => void;
}) {
  const p = product;
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{p?.name ?? "Product"}</DialogTitle></DialogHeader>
        {p && (
          <div className="space-y-4">
            <div className="flex gap-4">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="h-28 w-28 rounded-md object-cover border border-border" />
              ) : (
                <div className="h-28 w-28 rounded-md border border-dashed border-border grid place-items-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm flex-1">
                <Field label="SKU" value={p.sku ?? "—"} />
                <Field label="Barcode" value={p.barcode ?? "—"} />
                <Field label="HSN" value={p.hsn_code ?? "—"} />
                <Field label="GST" value={`${p.gst_rate}%`} />
                <Field label="MRP" value={inr(p.mrp)} />
                <Field label="Sale price" value={inr(p.sale_price)} />
                <Field label="Wholesale" value={inr(p.wholesale_price)} />
                <Field label="Purchase" value={inr(p.purchase_price)} />
                <Field label="Stock" value={`${num(p.stock, 0)} ${p.unit}`} />
                <Field label="Low stock at" value={num(p.low_stock_alert, 0)} />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2"><Layers className="h-4 w-4" /> Price variants</div>
              <VariantsEditor productId={p.id} />
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2"><HistoryIcon className="h-4 w-4" /> Recent purchases</div>
              <PurchaseHistory productId={p.id} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {p && <Button onClick={() => onEdit(p)}><Pencil className="h-4 w-4" /> Edit</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-border/60 py-0.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ProductForm({ value, onChange, categories }: {
  value: Partial<Product>; onChange: (v: Partial<Product>) => void;
  categories: { id: string; name: string }[];
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof Product, v: any) => onChange({ ...value, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Label>Name *</Label><Input value={value.name ?? ""} onChange={e => set("name", e.target.value)} />
      </div>
      <div><Label>SKU</Label><Input value={value.sku ?? ""} onChange={e => set("sku", e.target.value)} /></div>
      <div>
        <Label>Barcode</Label>
        <Input value={value.barcode ?? ""} onChange={e => set("barcode", e.target.value)} placeholder="Scan or type" />
      </div>
      <div>
        <Label>Category</Label>
        <Select value={value.category_id ?? "_none"} onValueChange={v => set("category_id", v === "_none" ? null : v)}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">— None —</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label>HSN code</Label><Input value={value.hsn_code ?? ""} onChange={e => set("hsn_code", e.target.value)} /></div>
      <div><Label>Unit</Label><Input value={value.unit ?? "PCS"} onChange={e => set("unit", e.target.value)} /></div>
      <div><Label>MRP</Label><Input type="number" value={value.mrp ?? 0} onChange={e => set("mrp", Number(e.target.value))} /></div>
      <div><Label>Sale price</Label><Input type="number" value={value.sale_price ?? 0} onChange={e => set("sale_price", Number(e.target.value))} /></div>
      <div><Label>Wholesale</Label><Input type="number" value={value.wholesale_price ?? 0} onChange={e => set("wholesale_price", Number(e.target.value))} /></div>
      <div><Label>Purchase</Label><Input type="number" value={value.purchase_price ?? 0} onChange={e => set("purchase_price", Number(e.target.value))} /></div>
      <div><Label>GST %</Label><Input type="number" value={value.gst_rate ?? 0} onChange={e => set("gst_rate", Number(e.target.value))} /></div>
      <div><Label>Opening stock</Label><Input type="number" value={value.stock ?? 0} onChange={e => set("stock", Number(e.target.value))} /></div>
      <div><Label>Low stock alert</Label><Input type="number" value={value.low_stock_alert ?? 0} onChange={e => set("low_stock_alert", Number(e.target.value))} /></div>
      <div className="col-span-2">
        <Label>Product image (upload or paste link)</Label>
        <div className="flex items-center gap-2 mt-1">
          {value.image_url ? (
            <img src={value.image_url} alt={value.name ?? "Product image"} className="h-14 w-14 rounded border object-cover" />
          ) : (
            <div className="h-14 w-14 rounded border grid place-items-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
          )}
          <Input className="flex-1" placeholder="https://…" value={value.image_url ?? ""} onChange={e => set("image_url", e.target.value)} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setUploading(true);
            const path = `products/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
            const { error } = await supabase.storage.from("store-assets").upload(path, f, { upsert: true });
            if (error) { setUploading(false); return toast.error(error.message); }
            const { data } = supabase.storage.from("store-assets").getPublicUrl(path);
            set("image_url", data.publicUrl);
            setUploading(false);
            toast.success("Image uploaded");
          }} />
          <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Multiple MRP / price variants ----
type Variant = { id: string; product_id: string; label: string | null; barcode: string | null; mrp: number; sale_price: number; purchase_price: number };

function VariantsEditor({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const { data: variants = [] } = useQuery({
    queryKey: ["variants", productId],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_variants").select("*").eq("product_id", productId).order("created_at");
      if (error) throw error;
      return data as Variant[];
    },
  });
  const [draft, setDraft] = useState({ label: "", barcode: "", mrp: "", sale_price: "", purchase_price: "" });

  const add = async () => {
    const { error } = await supabase.from("product_variants").insert({
      product_id: productId,
      label: draft.label || null,
      barcode: draft.barcode || null,
      mrp: Number(draft.mrp) || 0,
      sale_price: Number(draft.sale_price) || 0,
      purchase_price: Number(draft.purchase_price) || 0,
    });
    if (error) return toast.error(error.message);
    setDraft({ label: "", barcode: "", mrp: "", sale_price: "", purchase_price: "" });
    qc.invalidateQueries({ queryKey: ["variants", productId] });
    qc.invalidateQueries({ queryKey: ["variants-all"] });
  };

  const del = async (id: string) => {
    await supabase.from("product_variants").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["variants", productId] });
    qc.invalidateQueries({ queryKey: ["variants-all"] });
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 mb-2">
        <Layers className="h-4 w-4 text-primary" />
        <span className="font-display font-semibold text-sm">Multiple MRP / Price</span>
        <span className="text-xs text-muted-foreground">Shown as a chooser in POS when this barcode is scanned</span>
      </div>
      {variants.length > 0 && (
        <table className="w-full text-sm mb-2">
          <thead><tr className="text-[11px] uppercase text-muted-foreground">
            <th className="text-left py-1">Label</th><th className="text-left">Barcode</th>
            <th className="text-right">MRP</th><th className="text-right">Price</th><th className="text-right">Cost</th><th className="w-8" />
          </tr></thead>
          <tbody>
            {variants.map(v => (
              <tr key={v.id} className="border-t border-border">
                <td className="py-1">{v.label || "—"}</td>
                <td className="font-mono text-xs">{v.barcode || "—"}</td>
                <td className="text-right font-mono">{inr(v.mrp)}</td>
                <td className="text-right font-mono font-semibold">{inr(v.sale_price)}</td>
                <td className="text-right font-mono">{inr(v.purchase_price)}</td>
                <td><Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => del(v.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-6 gap-2 items-end">
        <div><Label className="text-xs">Label</Label><Input className="h-8" placeholder="Old stock" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></div>
        <div><Label className="text-xs">Barcode</Label><Input className="h-8" value={draft.barcode} onChange={e => setDraft({ ...draft, barcode: e.target.value })} /></div>
        <div><Label className="text-xs">MRP</Label><Input className="h-8" inputMode="decimal" value={draft.mrp} onChange={e => setDraft({ ...draft, mrp: e.target.value })} /></div>
        <div><Label className="text-xs">Price</Label><Input className="h-8" inputMode="decimal" value={draft.sale_price} onChange={e => setDraft({ ...draft, sale_price: e.target.value })} /></div>
        <div><Label className="text-xs">Cost</Label><Input className="h-8" inputMode="decimal" value={draft.purchase_price} onChange={e => setDraft({ ...draft, purchase_price: e.target.value })} /></div>
        <Button className="h-8" variant="secondary" onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </div>
    </div>
  );
}

// ---- Last purchases (Marg-style rate comparison) ----
function PurchaseHistory({ productId }: { productId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["product-purchase-history", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_items")
        .select("qty,cost,gst_rate,total,purchase:purchases(bill_no,bill_date,supplier_name)")
        .eq("product_id", productId)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const last4 = [...rows]
    .sort((a, b) => String(b.purchase?.bill_date ?? "").localeCompare(String(a.purchase?.bill_date ?? "")))
    .slice(0, 4);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 mb-2">
        <HistoryIcon className="h-4 w-4 text-primary" />
        <span className="font-display font-semibold text-sm">Last 4 purchases</span>
        <span className="text-xs text-muted-foreground">Compare supplier rates</span>
      </div>
      {last4.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No purchase history for this product yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase text-muted-foreground">
            <th className="text-left py-1">Date</th><th className="text-left">Bill #</th><th className="text-left">Supplier</th>
            <th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST%</th><th className="text-right">Amount</th>
          </tr></thead>
          <tbody>
            {last4.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{r.purchase?.bill_date ?? "—"}</td>
                <td className="font-mono text-xs">{r.purchase?.bill_no ?? "—"}</td>
                <td>{r.purchase?.supplier_name ?? "—"}</td>
                <td className="text-right font-mono">{num(r.qty, 0)}</td>
                <td className="text-right font-mono font-semibold">{inr(r.cost)}</td>
                <td className="text-right font-mono">{r.gst_rate}%</td>
                <td className="text-right font-mono">{inr(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function LabelDialog({ open, onClose, items, shopName }: {
  open: boolean; onClose: () => void; items: Product[]; shopName: string;
}) {
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const totalLabels = useMemo(() => items.reduce((a, p) => a + (copies[p.id] ?? 1), 0), [items, copies]);

  const buildJob = () => {
    const expanded: FixedLabel[] = [];
    for (const p of items) {
      const n = Math.max(1, Math.floor(copies[p.id] ?? 1));
      for (let i = 0; i < n; i++) {
        expanded.push({
          shop: shopName || "MART",
          name: p.name,
          code: p.barcode || p.sku || p.id.slice(0, 12),
          mrp: p.mrp ? Number(p.mrp).toFixed(2) : "",
          price: p.sale_price ? Number(p.sale_price).toFixed(2) : "",
        });
      }
    }
    return buildFixedLabelJob(expanded);
  };

  const doPrint = async () => {
    const tspl = buildJob();
    if (!tspl) return;
    setBusy(true);
    try {
      const mode = await printTsplDirect(tspl, "labels");
      toast.success(mode === "usb" ? "Sent to printer" : "Printer not paired — file downloaded");
    } catch (e: any) {
      toast.error(e?.message || "Print failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tags className="h-5 w-5" /> Print Barcode Labels — TSC TTP-244 Pro</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Fixed 2-up layout on 76 × 25 mm roll (25 × 38 mm each). First click asks you to pick the USB printer once, then prints directly.
          </p>
        </DialogHeader>
        <div className="border rounded max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="text-left py-1 px-2">Product</th><th className="text-left py-1">Barcode</th><th className="text-right py-1 px-2">Price</th><th className="text-right py-1 px-2 w-24">Copies</th></tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-1 px-2">{p.name}</td>
                  <td className="py-1 font-mono text-xs">{p.barcode || "—"}</td>
                  <td className="py-1 px-2 text-right font-mono">{inr(p.sale_price)}</td>
                  <td className="py-1 px-2 text-right">
                    <Input type="number" min={1} value={copies[p.id] ?? 1}
                      onChange={e => setCopies(c => ({ ...c, [p.id]: Math.max(1, Number(e.target.value) || 1) }))}
                      className="h-7 w-16 ml-auto text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="items-center">
          <span className="text-xs text-muted-foreground mr-auto">{totalLabels} label(s) · 2 per pass</span>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={doPrint} disabled={busy || totalLabels === 0}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Printer className="h-4 w-4 mr-1" />}
            {busy ? "Printing…" : `Print ${totalLabels}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// --- CSV helpers ---
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { q = false; }
      } else cur += ch;
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') { q = true; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function csvEsc(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
