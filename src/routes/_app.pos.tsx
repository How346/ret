import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Trash2, Plus, Minus, Pause, ListRestart, Printer, Banknote,
  CreditCard, Smartphone, Percent, ShoppingCart, X, UserPlus, Loader2,
  List as ListIcon,
} from "lucide-react";
import { inr, num } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useStoreSettings } from "@/hooks/use-store-settings";
import { printReceipt, buildReceiptHtml } from "@/lib/print-receipt";
import { sendReceiptOnWhatsApp, fillWhatsAppTemplate, normalizeWhatsAppPhone } from "@/lib/whatsapp-send";
import { MessageCircle, LayoutGrid } from "lucide-react";
import { onEnterFocusNext } from "@/lib/keyboard-nav";
import { invalidateReports } from "@/lib/report-invalidate";
import {
  getActiveLayout, setActiveLayout, listTemplates, saveTemplate, deleteTemplate, applyTemplate,
  DEFAULT_POS_LAYOUT, POS_PRESETS, type PosLayoutConfig,
} from "@/lib/pos-layout";

export const Route = createFileRoute("/_app/pos")({
  component: POS,
});

type Product = {
  id: string; name: string; sku: string | null; barcode: string | null;
  hsn_code: string | null; mrp: number; sale_price: number; wholesale_price: number;
  gst_rate: number; stock: number; unit: string; image_url?: string | null;
};

type Variant = {
  id: string; product_id: string; label: string | null; barcode: string | null;
  mrp: number; sale_price: number;
};

type CartItem = {
  product_id: string; name: string; hsn_code: string | null;
  qty: number; price: number; gst_rate: number; discount: number;
  mrp?: number;
};

type PriceLevel = "sale" | "wholesale" | "mrp";

function POS() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: settings } = useStoreSettings();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [billDiscount, setBillDiscount] = useState(0);
  const [priceLevel, setPriceLevel] = useState<PriceLevel>("sale");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [layout, setLayout] = useState<PosLayoutConfig>(() => getActiveLayout());
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => { setActiveLayout(layout); }, [layout]);
  const posContainerRef = useRef<HTMLDivElement>(null);

  // Drag a divider between panels 0/1/2 (Products | Cart | Summary) to
  // resize them, redistributing the width between just the two panels on
  // either side of that divider.
  const startResize = (dividerIdx: 0 | 1) => (e: React.MouseEvent) => {
    e.preventDefault();
    const container = posContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startCols: [number, number, number] = [...layout.colPct];
    const onMove = (ev: MouseEvent) => {
      const deltaPct = ((ev.clientX - startX) / rect.width) * 100;
      const a = dividerIdx, b = dividerIdx + 1;
      const minPct = 12;
      let next: [number, number, number] = [...startCols];
      const total = startCols[a] + startCols[b];
      let newA = startCols[a] + deltaPct;
      newA = Math.max(minPct, Math.min(total - minPct, newA));
      next[a] = Math.round(newA * 10) / 10;
      next[b] = Math.round((total - newA) * 10) / 10;
      setLayout((l) => ({ ...l, colPct: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [waAsk, setWaAsk] = useState<{
    phone: string;
    html: string;
    message: string;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Products
  const { data: products = [] } = useQuery({
    queryKey: ["products", "pos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode,hsn_code,mrp,sale_price,wholesale_price,gst_rate,stock,unit,image_url")
        .eq("is_active", true)
        .order("name")
        .limit(500);
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: variants = [] } = useQuery({
    queryKey: ["variants-all"],
    queryFn: async () => {
      const { data } = await supabase.from("product_variants").select("id,product_id,label,barcode,mrp,sale_price");
      return (data ?? []) as Variant[];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id,name,phone").order("name").limit(200);
      return data ?? [];
    },
  });

  const { data: heldBills = [], refetch: refetchHeld } = useQuery({
    queryKey: ["held"],
    queryFn: async () => {
      const { data } = await supabase.from("held_bills").select("*").order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  // Products that have an image are surfaced first in the POS grid.
  const imagesFirst = useCallback((list: Product[]) =>
    [...list].sort((a, b) => (a.image_url ? 0 : 1) - (b.image_url ? 0 : 1)), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return imagesFirst(products).slice(0, 60);
    return imagesFirst(products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q)
    )).slice(0, 60);
  }, [search, products, imagesFirst]);

  const variantsFor = useCallback(
    (pid: string) => variants.filter(v => v.product_id === pid),
    [variants]);

  const priceFor = useCallback((p: Product) =>
    priceLevel === "mrp" ? p.mrp : priceLevel === "wholesale" ? p.wholesale_price : p.sale_price,
  [priceLevel]);

  const addToCart = useCallback((p: Product) => {
    setCart(prev => {
      const i = prev.findIndex(x => x.product_id === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...prev, {
        product_id: p.id, name: p.name, hsn_code: p.hsn_code,
        qty: 1, price: priceFor(p), gst_rate: p.gst_rate, discount: 0,
      }];
    });
  }, [priceFor]);

  // Multiplier prefix, e.g. "3*" then scan → adds qty 3 of the next scanned item
  const qtyMultiplierRef = useRef<number>(1);

  const addToCartQty = useCallback((p: Product, qty: number) => {
    setCart(prev => {
      const i = prev.findIndex(x => x.product_id === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + qty };
        return next;
      }
      return [...prev, {
        product_id: p.id, name: p.name, hsn_code: p.hsn_code,
        qty, price: priceFor(p), gst_rate: p.gst_rate, discount: 0,
      }];
    });
  }, [priceFor]);

  // When a product has several MRP/price variants, ask which one to bill.
  const [variantAsk, setVariantAsk] = useState<{ product: Product; qty: number; variants?: Variant[] } | null>(null);

  const addSmart = useCallback((p: Product, qty: number) => {
    const vs = variantsFor(p.id);
    if (vs.length > 0) { setVariantAsk({ product: p, qty }); return; }
    addToCartQty(p, qty);
  }, [variantsFor, addToCartQty]);

  // Barcode scanners can fire immediately after app start, before the
  // variants-all query has finished loading.  For a direct product barcode,
  // always verify the product's variants from the database before billing it.
  // This guarantees that a product-level barcode opens the MRP picker whenever
  // multiple MRP/price variants exist, instead of silently adding the base
  // product.
  const addScannedProduct = useCallback(async (p: Product, qty: number) => {
    const localVariants = variantsFor(p.id);
    if (localVariants.length > 0) {
      setVariantAsk({ product: p, qty, variants: localVariants });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id,product_id,label,barcode,mrp,sale_price")
        .eq("product_id", p.id)
        .order("created_at");

      if (error) throw error;
      const freshVariants = (data ?? []) as Variant[];

      // Keep the picker in sync with the freshly fetched variants.  The
      // variants-all query may have been empty/stale when the scan happened.
      if (freshVariants.length > 0) {
        qc.setQueryData(["variants-all"], (current: Variant[] | undefined) => {
          const existing = current ?? [];
          const withoutProduct = existing.filter(v => v.product_id !== p.id);
          return [...withoutProduct, ...freshVariants];
        });
        setVariantAsk({ product: p, qty, variants: freshVariants });
        return;
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Unable to check product price variants");
      return;
    }

    addToCartQty(p, qty);
  }, [variantsFor, qc, addToCartQty]);

  const addVariant = (p: Product, v: Variant | null, qty: number) => {
    const price = v ? Number(v.sale_price) : p.sale_price;
    const mrp = v ? Number(v.mrp) : p.mrp;
    const key = v ? `${p.id}:${v.id}` : p.id;
    const name = p.name;
    setCart(prev => {
      const i = prev.findIndex(x => x.product_id === key);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + qty };
        return next;
      }
      return [...prev, { product_id: key, name, hsn_code: p.hsn_code, qty, price, gst_rate: p.gst_rate, discount: 0, mrp }];
    });
    setVariantAsk(null);
    setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 50);
  };

  const onSearchEnter = async () => {
    const raw = search.trim();
    if (!raw) { if (cart.length) setPayOpen(true); return; }
    // "N*" or "N*CODE" — sets multiplier for next scan
    const mult = raw.match(/^(\d+)\*(.*)$/);
    if (mult) {
      qtyMultiplierRef.current = Math.max(1, parseInt(mult[1], 10) || 1);
      const rest = mult[2].trim();
      if (!rest) { setSearch(""); return; }
      const p = products.find(pp => pp.barcode?.toLowerCase() === rest.toLowerCase() || pp.sku?.toLowerCase() === rest.toLowerCase());
      if (p) {
        const qty = qtyMultiplierRef.current;
        qtyMultiplierRef.current = 1;
        setSearch("");
        void addScannedProduct(p, qty);
      }
      return;
    }
    const q = raw.toLowerCase();

    // IMPORTANT: resolve a product-level barcode BEFORE resolving a variant
    // barcode. A product can have its own barcode and also have multiple
    // MRP/price variants. In that case the scan MUST open the price picker,
    // not silently bill a matching variant/default price.
    const qty = qtyMultiplierRef.current;

    // FIRST: resolve a parent-product barcode. This is intentionally before
    // variant-barcode resolution. If the parent has multiple MRP variants,
    // addScannedProduct() fetches the variants and opens the picker.
    let exactProduct = products.find(
      p => p.barcode?.trim().toLowerCase() === q || p.sku?.trim().toLowerCase() === q
    );

    // Do an exact database lookup as a fallback. This handles scanners used
    // immediately after startup and products outside the 500-row POS cache.
    if (!exactProduct) {
      try {
        const { data } = await supabase
          .from("products")
          .select("id,name,sku,barcode,hsn_code,mrp,sale_price,wholesale_price,gst_rate,stock,unit,image_url")
          .eq("barcode", raw)
          .eq("is_active", true)
          .maybeSingle();
        if (data) exactProduct = data as Product;
      } catch {
        // Continue to variant lookup below.
      }
    }

    if (exactProduct) {
      qtyMultiplierRef.current = 1;
      setSearch("");
      await addScannedProduct(exactProduct, qty);
      return;
    }

    // Only when the code is NOT the parent product barcode should it be
    // treated as a variant-specific barcode and billed directly.
    let vHit = variants.find(v => (v.barcode ?? "").trim().toLowerCase() === q);
    if (!vHit) {
      try {
        const { data } = await supabase
          .from("product_variants")
          .select("id,product_id,label,barcode,mrp,sale_price")
          .eq("barcode", raw)
          .maybeSingle();
        if (data) vHit = data as Variant;
      } catch {
        // No matching variant.
      }
    }
    if (vHit) {
      let parent = products.find(p => p.id === vHit!.product_id);
      if (!parent) {
        try {
          const { data } = await supabase
            .from("products")
            .select("id,name,sku,barcode,hsn_code,mrp,sale_price,wholesale_price,gst_rate,stock,unit,image_url")
            .eq("id", vHit.product_id)
            .maybeSingle();
          if (data) parent = data as Product;
        } catch {
          // Parent could not be resolved.
        }
      }
      if (parent) {
        addVariant(parent, vHit, qty);
        qtyMultiplierRef.current = 1;
        setSearch("");
        return;
      }
    }
    if (filtered.length === 1) {
      const qty = qtyMultiplierRef.current;
      qtyMultiplierRef.current = 1;
      setSearch("");
      void addScannedProduct(filtered[0], qty);
    }
  };


  // Totals
  const totals = useMemo(() => {
    let sub = 0, gst = 0;
    cart.forEach(it => {
      const line = it.qty * it.price - it.discount;
      const taxable = line / (1 + it.gst_rate / 100);
      const tax = line - taxable;
      sub += taxable;
      gst += tax;
    });
    const grossAfterBill = Math.max(0, sub + gst - billDiscount);
    const ratio = sub + gst > 0 ? grossAfterBill / (sub + gst) : 1;
    const subAdj = sub * ratio;
    const gstAdj = gst * ratio;
    return {
      subtotal: subAdj,
      cgst: gstAdj / 2,
      sgst: gstAdj / 2,
      total: grossAfterBill,
      itemCount: cart.reduce((a, b) => a + b.qty, 0),
    };
  }, [cart, billDiscount]);

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.flatMap(it => {
      if (it.product_id !== id) return [it];
      const q = it.qty + delta;
      return q <= 0 ? [] : [{ ...it, qty: q }];
    }));
  };
  const setLine = (id: string, patch: Partial<CartItem>) =>
    setCart(prev => prev.map(it => it.product_id === id ? { ...it, ...patch } : it));
  const removeLine = (id: string) => setCart(prev => prev.filter(it => it.product_id !== id));

  const clearBill = () => { setCart([]); setBillDiscount(0); setCustomerId(null); };

  const holdBill = async () => {
    if (!cart.length) return;
    const { error } = await supabase.from("held_bills").insert({
      cashier_id: user?.id, label: `${cart.length} items`,
      payload: { cart, billDiscount, customerId, priceLevel } as any,
    });
    if (error) return toast.error(error.message);
    toast.success("Bill held");
    clearBill();
    refetchHeld();
  };

  const recall = async (b: any) => {
    setCart(b.payload.cart);
    setBillDiscount(b.payload.billDiscount ?? 0);
    setCustomerId(b.payload.customerId ?? null);
    setPriceLevel(b.payload.priceLevel ?? "sale");
    await supabase.from("held_bills").delete().eq("id", b.id);
    refetchHeld();
  };

  // Keyboard shortcuts — Marg-style
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "F1" || e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F3" || e.key === "End") { e.preventDefault(); const el = document.getElementById("bill-discount"); (el as HTMLInputElement)?.focus(); (el as HTMLInputElement)?.select?.(); }
      else if (e.key === "F4") { e.preventDefault(); if (cart.length) setPayOpen(true); }
      else if (e.key === "F5") { e.preventDefault(); holdBill(); }
      else if (e.key === "F6") { e.preventDefault(); const el = document.getElementById("recall-btn"); (el as HTMLElement)?.click(); }
      else if (e.key === "F8") { e.preventDefault(); window.print(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "I")) { e.preventDefault(); setPickerOpen(true); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (cart.length) setPayOpen(true); }
      else if (e.key === "Escape" && !payOpen && !inField) { e.preventDefault(); clearBill(); }
      else if (e.key === "Escape" && payOpen) setPayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  useEffect(() => { searchRef.current?.focus(); }, []);

  // One shared scan/search control is rendered either in the existing left
  // panel (current look) or centered above the full POS workspace by the
  // Professional preset. This keeps keyboard/scanner behavior identical.
  const scanSearchControl = (
    <div className="relative flex items-center gap-1 w-full">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={searchRef}
          placeholder="Scan barcode or search… (F2)"
          className="pl-9 h-11 font-mono"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void onSearchEnter();
            }
          }}
        />
      </div>
      <Button type="button" variant="outline" size="sm" className="h-11 text-xs px-2 shrink-0" onClick={() => setPickerOpen(true)} title="All items (Ctrl+I)">
        <ListIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <div data-pos-root className="h-[calc(100vh-3rem)] flex flex-col bg-background [&_*:focus-visible]:outline-none [&_*:focus-visible]:ring-0 [&_*:focus-visible]:ring-offset-0">
      <div className="flex items-center justify-end px-3 pt-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCustomizing(true)}>
          <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Customize layout
        </Button>
      </div>
      {layout.searchPlacement === "center" && (
        <div className="px-3 pt-1 pb-2 flex justify-center">
          <div className="w-full max-w-3xl">{scanSearchControl}</div>
        </div>
      )}
      <div ref={posContainerRef} className="flex-1 min-h-0 flex gap-0 p-3 pt-1">
      {/* LEFT — search + product grid */}
      <Card className="flex flex-col overflow-hidden" style={{ width: `${layout.colPct[0]}%` }}>
        <div className="p-3 border-b border-border space-y-2">
          {layout.searchPlacement !== "center" && scanSearchControl}
          {layout.sections.priceLevelTabs && (
            <Tabs value={priceLevel} onValueChange={(v) => setPriceLevel(v as PriceLevel)}>
              <TabsList className="grid grid-cols-3 w-full h-8">
                <TabsTrigger value="sale" className="text-xs">Retail</TabsTrigger>
                <TabsTrigger value="wholesale" className="text-xs">Wholesale</TabsTrigger>
                <TabsTrigger value="mrp" className="text-xs">MRP</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No products. <a href="/products" className="text-primary underline">Add some →</a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 p-3">
              {filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => addSmart(p, 1)}
                  className="text-left rounded-lg border border-border bg-card hover:border-primary hover:shadow-sm transition p-2 group min-w-0"
                >
                  {layout.sections.productImages && p.image_url ? (
                    <img src={p.image_url} alt={p.name} loading="lazy" className="w-full aspect-[4/3] max-h-20 object-cover rounded mb-1.5" />
                  ) : null}
                  <div className="font-medium text-xs sm:text-sm leading-tight truncate">{p.name}</div>
                  <div className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                    {p.sku ?? p.barcode ?? "—"}
                  </div>
                  <div className="mt-2">
                    <span className="font-display font-bold text-xs sm:text-sm truncate">{inr(priceFor(p))}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      <div
        onMouseDown={startResize(0)}
        className="w-2 mx-0.5 shrink-0 cursor-col-resize group flex items-center justify-center"
        title="Drag to resize"
      >
        <div className="w-1 h-10 rounded-full bg-border group-hover:bg-primary transition-colors" />
      </div>

      {/* CENTER — cart */}
      <Card className="flex flex-col overflow-hidden" style={{ width: `${layout.colPct[1]}%` }}>
        <div className="px-4 h-12 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <span className="font-display font-semibold">Current Bill</span>
            <Badge variant="outline" className="text-[10px]">{totals.itemCount} items</Badge>
          </div>
          <div className="flex items-center gap-1">
            {heldBills.length > 0 && (
              <RecallMenu held={heldBills} onRecall={recall} />
            )}
            <Button variant="ghost" size="sm" onClick={clearBill} disabled={!cart.length}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {cart.length === 0 ? (
            <div className="grid place-items-center h-full p-12 text-center">
              <div>
                <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">Cart is empty</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Press <span className="kbd">F2</span> to search and start billing
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur border-b-2 border-border z-10">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-semibold py-2.5 px-3 w-8">#</th>
                  <th className="text-left font-semibold py-2.5 px-1">Item</th>
                  <th className="text-center font-semibold py-2.5 w-28">Qty</th>
                  <th className="text-right font-semibold py-2.5 w-24">Rate</th>
                  <th className="text-right font-semibold py-2.5 w-20">Disc</th>
                  <th className="text-right font-semibold py-2.5 px-3 w-28">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {cart.map((it, idx) => {
                  const line = it.qty * it.price - it.discount;
                  return (
                    <tr key={it.product_id} className="border-b border-border/60 odd:bg-muted/20 hover:bg-accent/30 transition-colors">
                      <td className="py-2 px-3 text-center text-xs text-muted-foreground font-mono tabular-nums">{idx + 1}</td>
                      <td className="py-2 px-1">
                        <div className="font-display font-semibold text-[14px] leading-tight text-foreground">{it.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          HSN {it.hsn_code ?? "—"} · GST {it.gst_rate}%
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQty(it.product_id, -1)}><Minus className="h-3 w-3" /></Button>
                          <Input
                            value={it.qty}
                            onChange={e => setLine(it.product_id, { qty: Number(e.target.value) || 0 })}
                            className="h-7 w-12 text-center px-1 font-mono font-semibold tabular-nums"
                          />
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQty(it.product_id, 1)}><Plus className="h-3 w-3" /></Button>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <Input
                          value={it.price}
                          onChange={e => setLine(it.product_id, { price: Number(e.target.value) || 0 })}
                          className="h-7 w-20 text-right font-mono tabular-nums ml-auto"
                        />
                      </td>
                      <td className="py-2 text-right">
                        <Input
                          value={it.discount}
                          onChange={e => setLine(it.product_id, { discount: Number(e.target.value) || 0 })}
                          className="h-7 w-16 text-right font-mono tabular-nums ml-auto"
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-[15px] text-foreground">{inr(line)}</td>
                      <td>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => removeLine(it.product_id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ScrollArea>

        {layout.sections.keypadHints && (
          <div className="border-t border-border p-2 flex items-center gap-2 bg-muted/30 text-[10px] text-muted-foreground overflow-x-auto">
            <Button variant="outline" size="sm" onClick={holdBill} disabled={!cart.length}>
              <Pause className="h-3.5 w-3.5 mr-1" /> Hold <span className="kbd ml-2">F5</span>
            </Button>
            <span className="whitespace-nowrap"><span className="kbd">F2</span> search · <span className="kbd">Ctrl+I</span> all items · <span className="kbd">End</span>/<span className="kbd">F3</span> discount · <span className="kbd">Enter</span> pay · <span className="kbd">F5</span> hold · <span className="kbd">F6</span> recall · <span className="kbd">F8</span> print · type <b>3*</b> then scan for qty 3</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" disabled={!cart.length} onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Print
            </Button>
          </div>
        )}
        {!layout.sections.keypadHints && (
          <div className="border-t border-border p-2 flex items-center gap-2 bg-muted/30">
            <Button variant="outline" size="sm" onClick={holdBill} disabled={!cart.length}>
              <Pause className="h-3.5 w-3.5 mr-1" /> Hold
            </Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" disabled={!cart.length} onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Print
            </Button>
          </div>
        )}

      </Card>

      <div
        onMouseDown={startResize(1)}
        className="w-2 mx-0.5 shrink-0 cursor-col-resize group flex items-center justify-center"
        title="Drag to resize"
      >
        <div className="w-1 h-10 rounded-full bg-border group-hover:bg-primary transition-colors" />
      </div>

      {/* RIGHT — totals + pay */}
      <Card className="flex flex-col overflow-hidden" style={{ width: `${layout.colPct[2]}%` }}>
        <div className="px-4 h-12 border-b border-border flex items-center justify-between">
          <span className="font-display font-semibold">Summary</span>
          <CustomerPicker customers={customers as any} value={customerId} onChange={setCustomerId} onAdded={() => qc.invalidateQueries({ queryKey: ["customers"] })} />
        </div>

        <div className="p-4 space-y-3 flex-1">
          {layout.sections.gstBreakdown && (
            <>
              <Row label="Subtotal" value={inr(totals.subtotal)} />
              <Row label="CGST" value={inr(totals.cgst)} />
              <Row label="SGST" value={inr(totals.sgst)} />
            </>
          )}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Percent className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground flex-1" title="Auto-distributed across every product line on save (Marg style)">Bill discount</Label>
            <Input
              id="bill-discount"
              value={billDiscount}
              onChange={e => setBillDiscount(Number(e.target.value) || 0)}
              onKeyDown={e => { if (e.key === "Enter" && cart.length) { e.preventDefault(); setPayOpen(true); } }}
              className="h-8 w-24 text-right font-mono font-semibold"
            />

          </div>

          <div className="mt-4 rounded-lg bg-primary text-primary-foreground p-4">
            <div className="text-[11px] uppercase tracking-wider opacity-80">Grand Total</div>
            <div className="font-display text-3xl font-bold tabular-nums mt-1">{inr(totals.total)}</div>
          </div>
        </div>

        <div className="border-t border-border p-3">
          <Button className="w-full h-12 text-base font-display" disabled={!cart.length} onClick={() => setPayOpen(true)}>
            Pay & Print <span className="kbd ml-2 bg-white/20 text-white border-white/30">F4</span>
          </Button>
        </div>
      </Card>
      </div>

      <PosLayoutPanel
        open={customizing}
        layout={layout}
        onClose={() => setCustomizing(false)}
        onChange={setLayout}
      />

      <VariantPickDialog
        ask={variantAsk}
        variants={variantAsk?.variants ?? (variantAsk ? variantsFor(variantAsk.product.id) : [])}
        onClose={() => { setVariantAsk(null); searchRef.current?.focus(); }}
        onPick={(v) => variantAsk && addVariant(variantAsk.product, v, variantAsk.qty)}
      />

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        total={totals.total}
        whatsappEnabled={!!settings?.whatsapp_enabled}
        onConfirm={async (split, action) => {
          try {
            const rpcName = (settings?.bill_no_format ?? "short") === "short" ? "next_invoice_no_short" : "next_invoice_no";
            const { data: invNo } = await supabase.rpc(rpcName as any);

            // Auto-distribute bill discount proportionally onto each line
            // (Marg-style): every product's own discount grows so the printed
            // bill reflects the discount per line, not as a lump sum.
            const grossPerLine = cart.map(it => it.qty * it.price);
            const grossSum = grossPerLine.reduce((a, b) => a + b, 0);
            const distCart = cart.map((it, i) => {
              const extra = grossSum > 0 ? (billDiscount * grossPerLine[i]) / grossSum : 0;
              return { ...it, discount: +(it.discount + extra).toFixed(2) };
            });

            const { data: sale, error: sErr } = await supabase.from("sales").insert({
              invoice_no: invNo as unknown as string,
              customer_id: customerId,
              cashier_id: user?.id,
              subtotal: totals.subtotal,
              discount: 0, // moved into per-line discounts
              cgst: totals.cgst,
              sgst: totals.sgst,
              total: totals.total,
              paid_cash: split.cash,
              paid_card: split.card,
              paid_upi: split.upi,
            }).select().single();
            if (sErr) throw sErr;

            const items = distCart.map(it => ({
              sale_id: sale!.id,
              product_id: it.product_id.split(":")[0],
              product_name: it.name,
              hsn_code: it.hsn_code,
              qty: it.qty,
              price: it.price,
              discount: it.discount,
              gst_rate: it.gst_rate,
              gst_amount: ((it.qty * it.price - it.discount) - (it.qty * it.price - it.discount) / (1 + it.gst_rate / 100)),
              total: it.qty * it.price - it.discount,
            }));
            await supabase.from("sale_items").insert(items);

            // stock decrement + ledger
            for (const it of distCart) {
              const pid = it.product_id.split(":")[0];
              const prod = products.find(p => p.id === pid);
              if (prod) {
                await supabase.from("products").update({ stock: prod.stock - it.qty }).eq("id", pid);
                await supabase.from("stock_ledger").insert({
                  product_id: pid, change: -it.qty,
                  reason: "sale", ref_id: sale!.id,
                });
              }
            }

            toast.success(`Invoice ${invNo} saved`);
            qc.invalidateQueries({ queryKey: ["products", "pos"] });
            invalidateReports(qc);
            setPayOpen(false);
            clearBill();
            const customer = customers.find((c: any) => c.id === customerId) ?? null;

            const receiptArgs = {
              invoiceNo: invNo as unknown as string,
              cart: distCart.map(it => {
                const prod = products.find(p => p.id === it.product_id.split(":")[0]);
                return { name: it.name, hsn_code: it.hsn_code, qty: it.qty, price: it.price, mrp: it.mrp ?? prod?.mrp ?? it.price, discount: it.discount, gst_rate: it.gst_rate };
              }),
              totals: { subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, discount: 0, total: totals.total },
              payment: split,
              customer: customer as any,
              settings,
            };

            if (action === "print") {
              printReceipt(receiptArgs);
            } else if (action === "whatsapp") {
              const html = buildReceiptHtml(receiptArgs);
              const message = fillWhatsAppTemplate(settings?.whatsapp_message_template, {
                customer: customer?.name || "Customer",
                shop: settings?.shop_name || "our store",
                invoice: invNo as unknown as string,
                total: inr(totals.total),
              });
              const phone = normalizeWhatsAppPhone(customer?.phone || "", settings?.whatsapp_country_code);
              setWaAsk({ phone, html, message });
            }
            // action === "save": bill is already saved above, nothing further to do.
          } catch (err: any) {
            toast.error(err.message ?? "Failed to save sale");
          }
        }}
      />

      <WhatsAppSendDialog
        ask={waAsk}
        paperSize={settings?.paper_size}
        onClose={() => setWaAsk(null)}
      />

      <ProductPickerDialog
        open={pickerOpen}
        products={products}
        onClose={() => { setPickerOpen(false); searchRef.current?.focus(); }}
        onPick={(p) => {
          addSmart(p, qtyMultiplierRef.current || 1);
          qtyMultiplierRef.current = 1;
          setPickerOpen(false);
          searchRef.current?.focus();
        }}
      />

    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

// "All items" picker for POS billing — opened via Ctrl+I or the button next
// to the search box, for adding to the cart without scanning/typing a code.
// Arrow keys move the highlighted row, Enter adds it (same variant-picker
// flow as a normal scan, via addSmart).
function ProductPickerDialog({
  open, products, onClose, onPick,
}: {
  open: boolean;
  products: { id: string; name: string; barcode: string | null; sku: string | null; sale_price: number; stock: number }[];
  onClose: () => void;
  onPick: (p: any) => void;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products.slice(0, 200);
    return products.filter((p) =>
      p.name.toLowerCase().includes(term) ||
      (p.barcode ?? "").toLowerCase().includes(term) ||
      (p.sku ?? "").toLowerCase().includes(term),
    ).slice(0, 200);
  }, [q, products]);

  useEffect(() => {
    if (open) {
      setQ("");
      setHi(0);
      setTimeout(() => searchInputRef.current?.focus(), 30);
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
            ref={searchInputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, barcode or SKU…"
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
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono text-muted-foreground">{p.barcode || p.sku || "—"}</span>
                <span className="text-xs font-mono">{inr(p.sale_price)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">↑↓ to move · Enter to add · Esc to close</div>
      </DialogContent>
    </Dialog>
  );
}

// Customize the POS screen: show/hide optional sections, and save the
// current layout (including panel widths, dragged on the page itself) as a
// named template to switch between later. Saved per-device in localStorage.
function PosLayoutPanel({
  open, layout, onClose, onChange,
}: {
  open: boolean;
  layout: PosLayoutConfig;
  onClose: () => void;
  onChange: (l: PosLayoutConfig) => void;
}) {
  const [templates, setTemplates] = useState(() => listTemplates());
  const [newName, setNewName] = useState("");
  useEffect(() => { if (open) setTemplates(listTemplates()); }, [open]);

  const toggle = (key: keyof PosLayoutConfig["sections"]) => (v: boolean) => {
    onChange({ ...layout, sections: { ...layout.sections, [key]: v } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Customize POS layout</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Keep the existing layout if you like, drag the thin dividers to resize panels, or use a ready-made preset above. Presets are one-click and do not delete your saved templates.
          </p>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Ready-made layouts</Label>
            <div className="grid grid-cols-2 gap-2">
              {POS_PRESETS.map((preset) => {
                const selected =
                  layout.searchPlacement === preset.config.searchPlacement &&
                  layout.colPct.every((v, i) => Math.abs(v - preset.config.colPct[i]) < 0.2) &&
                  layout.sections.productImages === preset.config.sections.productImages;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => { onChange(preset.config); toast.success(`Applied ${preset.name} layout`); }}
                    className={`rounded-lg border p-3 text-left transition ${selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50"}`}
                  >
                    <div className="font-semibold text-sm">{preset.name}</div>
                    <div className="text-[11px] leading-4 text-muted-foreground mt-1">{preset.description}</div>
                    <div className="mt-2 text-[10px] font-medium text-primary">One-click apply</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Current layout options</Label>
            <ToggleRow label="Retail / Wholesale / MRP tabs" checked={layout.sections.priceLevelTabs} onChange={toggle("priceLevelTabs")} />
            <ToggleRow label="Keyboard shortcut hint strip" checked={layout.sections.keypadHints} onChange={toggle("keypadHints")} />
            <ToggleRow label="CGST / SGST breakdown in Summary" checked={layout.sections.gstBreakdown} onChange={toggle("gstBreakdown")} />
            <ToggleRow label="Product photos in the grid" checked={layout.sections.productImages} onChange={toggle("productImages")} />
          </div>

          <div className="pt-3 border-t border-border space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Save as template</Label>
            <div className="flex gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Counter 1" />
              <Button
                variant="outline"
                disabled={!newName.trim()}
                onClick={() => {
                  saveTemplate(newName.trim(), layout);
                  setTemplates(listTemplates());
                  setNewName("");
                  toast.success(`Saved template "${newName.trim()}"`);
                }}
              >
                Save
              </Button>
            </div>
          </div>

          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Saved templates</Label>
              {templates.map((t) => (
                <div key={t.name} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 h-9">
                  <span className="text-sm truncate">{t.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => {
                        const cfg = applyTemplate(t.name);
                        if (cfg) { onChange(cfg); toast.success(`Applied "${t.name}"`); }
                      }}
                    >
                      Apply
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={() => { deleteTemplate(t.name); setTemplates(listTemplates()); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onChange(DEFAULT_POS_LAYOUT)}
          >
            Reset to default
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border px-3 h-10 cursor-pointer hover:bg-accent/50">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

function RecallMenu({ held, onRecall }: { held: any[]; onRecall: (b: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button id="recall-btn" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListRestart className="h-3.5 w-3.5 mr-1" /> Recall ({held.length})

      </Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Held bills</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-96 overflow-auto">
          {held.map(b => (
            <button
              key={b.id}
              onClick={() => { onRecall(b); setOpen(false); }}
              className="w-full text-left p-3 rounded border border-border hover:border-primary"
            >
              <div className="font-medium text-sm">{b.label}</div>
              <div className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomerPicker({
  customers, value, onChange, onAdded,
}: { customers: { id: string; name: string; phone?: string }[]; value: string | null; onChange: (id: string | null) => void; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const selected = customers.find(c => c.id === value);

  return (
    <div className="flex items-center gap-1">
      <select
        value={value ?? ""}
        onChange={e => onChange(e.target.value || null)}
        className="h-7 text-xs rounded border border-border bg-background px-1.5 max-w-[120px]"
      >
        <option value="">Walk-in</option>
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" />
        </Button>
        <DialogContent>
          <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
          <div className="space-y-3" data-enter-nav onKeyDown={onEnterFocusNext}>
            <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} /></div>
            <DialogFooter>
              <Button onClick={async () => {
                if (!name) return;
                const { data, error } = await supabase.from("customers").insert({ name, phone }).select().single();
                if (error) return toast.error(error.message);
                onAdded(); onChange(data!.id); setOpen(false); setName(""); setPhone("");
              }}>Save</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      {selected?.phone && <span className="text-[10px] text-muted-foreground">{selected.phone}</span>}
    </div>
  );
}

function PaymentDialog({
  open, onOpenChange, total, onConfirm, whatsappEnabled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  total: number;
  whatsappEnabled: boolean;
  onConfirm: (split: { cash: number; card: number; upi: number }, action: "print" | "save" | "whatsapp") => void | Promise<void>;
}) {
  const [saving, setSaving] = useState<null | "print" | "save" | "whatsapp">(null);
  const [cash, setCash] = useState(0);
  const [card, setCard] = useState(0);
  const [upi, setUpi] = useState(0);
  const cashRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLInputElement>(null);
  const upiRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const actionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { if (open) { setCash(total); setCard(0); setUpi(0); } }, [open, total]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { cashRef.current?.focus(); cashRef.current?.select(); }, 60);
    return () => clearTimeout(t);
  }, [open]);
  const step = (next: React.RefObject<HTMLInputElement | HTMLButtonElement | null>) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = next.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  };

  const paid = cash + card + upi;
  const change = paid - total;
  const canConfirm = paid >= total - 0.01 && !saving;

  const run = async (action: "print" | "save" | "whatsapp") => {
    if (saving) return;
    setSaving(action);
    try { await onConfirm({ cash, card, upi }, action); } finally { setSaving(null); }
  };

  // Left/Right (and Up/Down) arrow-key navigation across the confirm
  // buttons below, so a cashier working entirely from the keyboard can
  // move between "Confirm Only" / "Confirm & Send" / "Confirm & Print"
  // without reaching for the mouse.
  const onActionsKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const refs = actionRefs.current.filter((el): el is HTMLButtonElement => !!el);
    if (!refs.length) return;
    const activeIdx = refs.indexOf(document.activeElement as HTMLButtonElement);
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const nextIdx = activeIdx === -1
      ? (forward ? 0 : refs.length - 1)
      : (activeIdx + (forward ? 1 : -1) + refs.length) % refs.length;
    refs[nextIdx]?.focus();
  };

  const actions = [
    {
      key: "save" as const,
      label: "Confirm Only",
      hint: "Save the bill — no printing, no sending",
      variant: "outline" as const,
      icon: null as React.ReactNode,
    },
    ...(whatsappEnabled
      ? [{
          key: "whatsapp" as const,
          label: "Confirm & Send",
          hint: "Save, then send on WhatsApp",
          variant: "outline" as const,
          icon: <MessageCircle className="h-4 w-4" />,
        }]
      : []),
    {
      key: "print" as const,
      label: "Confirm & Print",
      hint: "Save and print the receipt",
      variant: "default" as const,
      icon: <Printer className="h-4 w-4" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Payment</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg bg-muted p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Amount due</div>
          <div className="font-display text-3xl font-bold mt-1">{inr(total)}</div>
        </div>
        <div className="space-y-3">
          <PayRow inputRef={cashRef} onKeyDown={step(cardRef)} icon={<Banknote className="h-4 w-4" />} label="Cash" value={cash} onChange={setCash} />
          <PayRow inputRef={cardRef} onKeyDown={step(upiRef)} icon={<CreditCard className="h-4 w-4" />} label="Card / Credit" value={card} onChange={setCard} />
          <PayRow inputRef={upiRef} onKeyDown={step(confirmRef)} icon={<Smartphone className="h-4 w-4" />} label="UPI" value={upi} onChange={setUpi} />

        </div>
        <div className="mt-2 rounded-lg border-2 border-foreground/10 bg-foreground/[0.03] p-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Return / Change</div>
          <div
            className={`font-display font-black tracking-tight mt-1 ${change < 0 ? "text-destructive" : "text-foreground"}`}
            style={{ fontSize: "2.75rem", lineHeight: 1, color: change < 0 ? undefined : "#000" }}
          >
            {inr(Math.max(0, change))}
          </div>
          {change < 0 && <div className="text-xs text-destructive mt-1">Short by {inr(Math.abs(change))}</div>}
        </div>

        <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch">
          <Button variant="ghost" size="sm" disabled={!!saving} onClick={() => onOpenChange(false)} className="self-start px-2 h-8 text-muted-foreground">
            Cancel
          </Button>
          <div
            role="group"
            aria-label="Confirm payment"
            onKeyDown={onActionsKeyDown}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
          >
            {actions.map((a, idx) => (
              <Button
                key={a.key}
                ref={(el) => {
                  actionRefs.current[idx] = el;
                  if (a.key === "print") confirmRef.current = el;
                }}
                variant={a.variant}
                title={a.hint}
                disabled={!canConfirm && saving !== a.key}
                className="h-auto py-2.5 flex-col gap-1 whitespace-normal text-center"
                onClick={() => run(a.key)}
              >
                <span className="flex items-center gap-1.5">
                  {saving === a.key ? <Loader2 className="h-4 w-4 animate-spin" /> : a.icon}
                  <span className="font-medium">{a.label}</span>
                </span>
              </Button>
            ))}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WhatsAppSendDialog({
  ask, paperSize, onClose,
}: {
  ask: { phone: string; html: string; message: string } | null;
  paperSize?: "58mm" | "80mm" | "A4";
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { setPhone(ask?.phone ?? ""); }, [ask]);

  const send = async () => {
    if (!ask || !phone.trim() || sending) return;
    setSending(true);
    try {
      const res = await sendReceiptOnWhatsApp({
        html: ask.html,
        phone,
        paperSize,
      });
      if (res.success) {
        toast.success("Bill image sent to WhatsApp");
        onClose();
      } else {
        toast.error(res.errorType || "WhatsApp could not send the bill image");
      }
    } catch (error: any) {
      toast.error(String(error?.message || error || "WhatsApp sending failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!ask} onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Send bill image on WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>WhatsApp number</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="10-digit mobile number"
              autoFocus
              inputMode="tel"
              disabled={sending}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The bill is rendered directly in memory and sent as a PNG image. No bill image file is created and no browser window is opened.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={onClose}>Cancel</Button>
          <Button disabled={!phone.trim() || sending} onClick={() => void send()}>
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {sending ? "Sending image…" : "Send Bill Image"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayRow({ icon, label, value, onChange, inputRef, onKeyDown }: {
  icon: React.ReactNode; label: string; value: number; onChange: (n: number) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>; onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-9 w-9 rounded grid place-items-center bg-muted text-muted-foreground">{icon}</div>
      <Label className="flex-1 text-sm">{label}</Label>
      <Input ref={inputRef} onKeyDown={onKeyDown} type="number" value={value} onChange={e => onChange(Number(e.target.value) || 0)} className="w-32 text-right font-mono" />
    </div>
  );

}

// printReceipt now lives in src/lib/print-receipt.ts

function VariantPickDialog({
  ask, variants, onClose, onPick,
}: {
  ask: { product: Product; qty: number } | null;
  variants: Variant[];
  onClose: () => void;
  onPick: (v: Variant | null) => void;
}) {
  // Fully keyboard driven: Up/Down highlight, Enter bills the highlighted
  // price, 1-9 pick a row straight away, Esc cancels.
  const options: (Variant | null)[] = [null, ...variants];
  const [sel, setSel] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (ask) setSel(0); }, [ask]);

  // Radix Dialog uses a focus trap, so a handler attached only to DialogContent
  // can occasionally miss arrow keys. Capture them at window level while this
  // dialog is open; selection never depends on browser focus.
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSel((i) => e.key === "ArrowDown" ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onPick(options[sel] ?? null);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < options.length) { e.preventDefault(); e.stopPropagation(); onPick(options[i] ?? null); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask, options.length, onPick, sel]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <Dialog open={!!ask} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-md outline-none ring-0 focus:outline-none focus:ring-0 focus:ring-offset-0 [&_*:focus]:outline-none [&_*:focus]:ring-0 [&_*:focus]:ring-offset-0 [&_*:focus-visible]:outline-none [&_*:focus-visible]:ring-0 [&_*:focus-visible]:ring-offset-0"
      >
        <DialogHeader>
          <DialogTitle>Select price — {ask?.product.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2" tabIndex={-1}>
          {options.map((v, i) => (
            <button
              key={v?.id ?? "default"}
              ref={sel === i ? activeRowRef : undefined}
              tabIndex={-1}
              autoFocus={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              className={`w-full rounded-md border p-3 text-left transition outline-none ring-0 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
                sel === i ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
              }`}
              onClick={() => onPick(v)}
            >
              <div className="font-medium flex items-center gap-2">
                <span className="kbd">{i + 1}</span>
                {v ? (v.label || v.barcode || "Variant") : "Default"}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                MRP {inr(v ? v.mrp : ask?.product.mrp ?? 0)} · Price {inr(v ? v.sale_price : ask?.product.sale_price ?? 0)}
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <span className="text-xs text-muted-foreground mr-auto">↑↓ choose · Enter bill · 1-9 quick pick</span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
