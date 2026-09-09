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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { inr } from "@/lib/format";
import { formatIndianDate, formatIndianDateTime } from "@/lib/date-format";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Printer, Pencil, Trash2, Search, Download, FileText, Scan, ShoppingCart, Plus, Minus, X } from "lucide-react";
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
      [s.invoice_no, formatIndianDateTime(s.created_at), s.customers?.name ?? "Walk-in",
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
                  <td className="py-2 whitespace-nowrap">{formatIndianDateTime(s.created_at)}</td>
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
          <p className="text-xs text-muted-foreground">{formatIndianDateTime(sale.created_at)} · {sale.customers?.name ?? "Walk-in"}</p>
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
  const [items,setItems]=useState<any[]>([]); const [originalItems,setOriginalItems]=useState<any[]>([]); const [products,setProducts]=useState<any[]>([]); const [customers,setCustomers]=useState<any[]>([]);
  const [customerId,setCustomerId]=useState<string>(""); const [discount,setDiscount]=useState(0); const [notes,setNotes]=useState(""); const [cash,setCash]=useState(0); const [card,setCard]=useState(0); const [upi,setUpi]=useState(0); const [saving,setSaving]=useState(false); const [search,setSearch]=useState(""); const [barcode,setBarcode]=useState(""); const [origTotal,setOrigTotal]=useState(0); const searchRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!sale)return;setCustomerId(sale.customer_id??"");setDiscount(Number(sale.discount)||0);setNotes(sale.notes??"");setCash(Number(sale.paid_cash)||0);setCard(Number(sale.paid_card)||0);setUpi(Number(sale.paid_upi)||0);setOrigTotal(Number(sale.total)||0);(async()=>{const [ir,pr,cr]=await Promise.all([loadItems(sale.id),supabase.from("products").select("id,name,sku,barcode,hsn_code,mrp,sale_price,gst_rate,stock").eq("is_active",true).order("name").limit(500),supabase.from("customers").select("id,name,phone").order("name").limit(300)]);setItems(ir.map((x:any)=>({...x,qty:Number(x.qty)||0,price:Number(x.price)||0,discount:Number(x.discount)||0,gst_rate:Number(x.gst_rate)||0})));setOriginalItems(ir);setProducts(pr.data??[]);setCustomers(cr.data??[]);setTimeout(()=>searchRef.current?.focus(),80)})()},[sale,loadItems]);
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return products.slice(0,30);return products.filter(p=>p.name.toLowerCase().includes(q)||(p.barcode??"").toLowerCase().includes(q)||(p.sku??"").toLowerCase().includes(q)).slice(0,30)},[search,products]);
  const add=(p:any)=>{setItems(a=>[...a,{id:`new-${crypto.randomUUID()}`,_new:true,sale_id:sale.id,product_id:p.id,product_name:p.name,hsn_code:p.hsn_code??null,qty:1,price:Number(p.sale_price)||0,discount:0,gst_rate:Number(p.gst_rate)||0}]);setSearch("");setTimeout(()=>searchRef.current?.focus(),30)};
  const update=(id:string,patch:any)=>setItems(a=>a.map(x=>x.id===id?{...x,...patch}:x));
  const totals=useMemo(()=>{let gross=0,tax=0;for(const i of items){const line=Math.max(0,Number(i.qty)*Number(i.price)-Number(i.discount||0));const taxable=line/(1+Number(i.gst_rate||0)/100);gross+=line;tax+=line-taxable}const after=Math.max(0,gross-discount);const ratio=gross>0?after/gross:1;return {gross,after,tax:tax*ratio,sub:(gross-tax)*ratio}},[items,discount]);
  const difference=totals.after-origTotal;
  const save=async()=>{setSaving(true);try{
    const oldBy=new Map<string,number>();for(const i of originalItems){if(i.product_id)oldBy.set(i.product_id,(oldBy.get(i.product_id)||0)+Number(i.qty||0))}const newBy=new Map<string,number>();for(const i of items){if(i.product_id)newBy.set(i.product_id,(newBy.get(i.product_id)||0)+Number(i.qty||0))}
    const ids=new Set([...oldBy.keys(),...newBy.keys()]);for(const pid of ids){const delta=(oldBy.get(pid)||0)-(newBy.get(pid)||0);if(!delta)continue;const {data:p}=await supabase.from("products").select("stock").eq("id",pid).single();if(p)await supabase.from("products").update({stock:Number(p.stock)+delta}).eq("id",pid);if(delta!==0)await supabase.from("stock_ledger").insert({product_id:pid,change:delta,reason:"sale_edit",ref_id:sale.id})}
    await supabase.from("sale_items").delete().eq("sale_id",sale.id);const gross=totals.gross;const ratio=gross>0?totals.after/gross:1;const rows=items.filter(i=>i.product_id&&Number(i.qty)>0).map(i=>{const line=Math.max(0,Number(i.qty)*Number(i.price)-Number(i.discount||0));const taxable=line/(1+Number(i.gst_rate||0)/100);return {sale_id:sale.id,product_id:i.product_id,product_name:i.product_name,hsn_code:i.hsn_code,qty:Number(i.qty),price:Number(i.price),discount:Number(i.discount||0),gst_rate:Number(i.gst_rate||0),gst_amount:(line-taxable)*ratio,total:line}});const {error:ie}=await supabase.from("sale_items").insert(rows);if(ie)throw ie;
    const {error:e}=await supabase.from("sales").update({customer_id:customerId||null,subtotal:totals.sub,cgst:totals.tax/2,sgst:totals.tax/2,igst:0,total:totals.after,discount,paid_cash:Number(cash)||0,paid_card:Number(card)||0,paid_upi:Number(upi)||0,notes,edited_by:userId}).eq("id",sale.id);if(e)throw e;toast.success(`Invoice updated · Difference ${difference>=0?"+":"−"}${inr(Math.abs(difference))}`);onSaved();
  }catch(e:any){toast.error(e.message??"Failed to update invoice")}finally{setSaving(false)}};
  if(!sale)return null;
  return <Dialog open onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-6xl max-h-[94vh] p-0 flex flex-col overflow-hidden" onKeyDown={e=>{if(e.key==="End"&&!saving){e.preventDefault();void save()}}}>
    <DialogHeader className="px-5 pt-5 pb-3 border-b"><DialogTitle className="font-display text-xl">Edit Sale / Invoice <span className="font-mono">{sale.invoice_no}</span></DialogTitle></DialogHeader>
    <div className="flex-1 min-h-0 p-3 overflow-hidden"><div className="grid grid-cols-12 gap-3 h-full min-h-0">
      <Card className="col-span-3 flex flex-col overflow-hidden"><div className="p-3 border-b"><Label className="text-xs uppercase tracking-wide">Add / Scan Product</Label><div className="relative mt-2"><Scan className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/><Input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();const p=filtered[0];if(p)add(p)}}} placeholder="Scan barcode / search…" className="pl-8"/></div></div><ScrollArea className="flex-1"><div className="p-2 space-y-1">{filtered.map(p=><button key={p.id} type="button" onClick={()=>add(p)} className="w-full rounded-md border p-2 text-left hover:bg-accent flex justify-between gap-2"><span className="text-sm truncate">{p.name}</span><span className="font-mono text-xs shrink-0">{inr(Number(p.sale_price)||0)}</span></button>)}</div></ScrollArea></Card>
      <Card className="col-span-6 flex flex-col overflow-hidden"><div className="px-4 h-12 border-b flex items-center justify-between"><div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary"/><span className="font-display font-semibold">Current Bill</span><Badge variant="outline" className="text-[10px]">{items.reduce((a,i)=>a+Number(i.qty||0),0)} items</Badge></div><Button variant="ghost" size="sm" onClick={()=>setItems([])} disabled={!items.length}><X className="h-3.5 w-3.5 mr-1"/>Clear</Button></div><ScrollArea className="flex-1"><table className="w-full text-[13px]"><thead className="sticky top-0 bg-muted/60 border-b z-10"><tr className="text-[11px] uppercase tracking-wider text-muted-foreground"><th className="text-left p-2">Item</th><th className="p-2 w-24">Qty</th><th className="p-2 w-24">Rate</th><th className="p-2 w-20">Disc</th><th className="text-right p-2 w-24">Amount</th><th/></tr></thead><tbody>{items.map(i=>{const line=Math.max(0,Number(i.qty)*Number(i.price)-Number(i.discount||0));return <tr key={i.id} className="border-b"><td className="p-2"><div className="font-semibold">{i.product_name}</div><div className="text-[10px] text-muted-foreground">HSN {i.hsn_code??"—"} · GST {i.gst_rate}%</div></td><td className="p-2"><div className="flex items-center justify-center gap-1"><Button size="icon" variant="ghost" className="h-6 w-6" onClick={()=>update(i.id,{qty:Math.max(0,Number(i.qty)-1)})}><Minus className="h-3 w-3"/></Button><Input value={i.qty} onChange={e=>update(i.id,{qty:Number(e.target.value)||0})} className="h-7 w-12 text-center px-1"/><Button size="icon" variant="ghost" className="h-6 w-6" onClick={()=>update(i.id,{qty:Number(i.qty)+1})}><Plus className="h-3 w-3"/></Button></div></td><td className="p-2"><Input value={i.price} onChange={e=>update(i.id,{price:Number(e.target.value)||0})} className="h-7 text-right font-mono"/></td><td className="p-2"><Input value={i.discount} onChange={e=>update(i.id,{discount:Number(e.target.value)||0})} className="h-7 text-right font-mono"/></td><td className="p-2 text-right font-mono font-bold">{inr(line)}</td><td><Button size="icon" variant="ghost" onClick={()=>setItems(a=>a.filter(x=>x.id!==i.id))}><Trash2 className="h-3.5 w-3.5 text-destructive"/></Button></td></tr>})}</tbody></table></ScrollArea></Card>
      <Card className="col-span-3 flex flex-col overflow-hidden"><div className="px-4 h-12 border-b font-display font-semibold flex items-center">Invoice Summary</div><div className="p-4 space-y-3 flex-1 overflow-auto"><Label>Customer</Label><Select value={customerId||"walkin"} onValueChange={v=>setCustomerId(v==="walkin"?"":v)}><SelectTrigger><SelectValue placeholder="Walk-in"/></SelectTrigger><SelectContent><SelectItem value="walkin">Walk-in</SelectItem>{customers.map(c=><SelectItem key={c.id} value={c.id}>{c.name}{c.phone?` · ${c.phone}`:""}</SelectItem>)}</SelectContent></Select><Label className="block mt-2">Bill Discount</Label><Input inputMode="decimal" value={discount} onChange={e=>setDiscount(Number(e.target.value)||0)}/><div className="space-y-2 pt-2 border-t"><div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-mono">{inr(totals.sub)}</span></div><div className="flex justify-between text-sm"><span>GST</span><span className="font-mono">{inr(totals.tax)}</span></div><div className="rounded-lg bg-primary text-primary-foreground p-3"><div className="text-[10px] uppercase opacity-80">New Grand Total</div><div className="font-display text-2xl font-bold">{inr(totals.after)}</div></div><div className={`rounded-lg border p-3 ${difference===0?"bg-muted/30":difference>0?"bg-destructive/5":"bg-emerald-500/5"}`}><div className="text-xs text-muted-foreground">Amount Difference</div><div className="font-display text-xl font-bold">{difference>=0?"+":"−"}{inr(Math.abs(difference))}</div><div className="text-[10px] text-muted-foreground mt-1">Original {inr(origTotal)}</div></div></div><Label className="block">Cash</Label><Input inputMode="decimal" value={cash} onChange={e=>setCash(Number(e.target.value)||0)}/><Label>Card</Label><Input inputMode="decimal" value={card} onChange={e=>setCard(Number(e.target.value)||0)}/><Label>UPI</Label><Input inputMode="decimal" value={upi} onChange={e=>setUpi(Number(e.target.value)||0)}/><Label>Notes</Label><Input value={notes} onChange={e=>setNotes(e.target.value)}/></div></Card>
    </div></div>
    <DialogFooter className="border-t px-5 py-3"><div className="text-xs text-muted-foreground mr-auto">POS-style editor · edit products, qty, rate, discount, customer, payment and notes · Amount Difference shown live</div><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving?"Saving…":"Save Changes"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

