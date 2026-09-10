import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download } from "lucide-react";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      void queryClient.refetchQueries({ queryKey: ["report-sales", from, to] });
      void queryClient.refetchQueries({ queryKey: ["report-saleitems", from, to] });
      void queryClient.refetchQueries({ queryKey: ["report-products"] });
    };
    window.addEventListener("erp:data-changed", refresh);
    return () => window.removeEventListener("erp:data-changed", refresh);
  }, [queryClient, from, to]);

  const { data: sales = [] } = useQuery({
    queryKey: ["report-sales", from, to],
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales").select("*")
        .gte("created_at", new Date(`${from}T00:00:00+05:30`).toISOString())
        .lte("created_at", new Date(`${to}T23:59:59.999+05:30`).toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["report-products"],
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*");
      return data ?? [];
    },
  });

  const { data: saleItems = [] } = useQuery({
    queryKey: ["report-saleitems", from, to],
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase.from("sale_items").select("*, sales!inner(created_at)")
        .gte("sales.created_at", new Date(`${from}T00:00:00+05:30`).toISOString())
        .lte("sales.created_at", new Date(`${to}T23:59:59.999+05:30`).toISOString());
      return data ?? [];
    },
  });

  const dailySummary = useMemo(() => {
    const map = new Map<string, { date: string; bills: number; total: number; tax: number }>();
    for (const s of sales as any[]) {
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(s.created_at));
      const e = map.get(d) ?? { date: d, bills: 0, total: 0, tax: 0 };
      e.bills += 1;
      e.total += Number(s.total ?? 0);
      e.tax += Number(s.cgst ?? 0) + Number(s.sgst ?? 0) + Number(s.igst ?? 0);
      map.set(d, e);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [sales]);

  const totals = useMemo(() => {
    let total = 0, tax = 0;
    for (const s of sales as any[]) {
      total += Number(s.total ?? 0);
      tax += Number(s.cgst ?? 0) + Number(s.sgst ?? 0) + Number(s.igst ?? 0);
    }
    return { total, tax, bills: sales.length };
  }, [sales]);

  const topProducts = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; amount: number }>();
    for (const i of saleItems as any[]) {
      const k = i.product_name as string;
      const e = m.get(k) ?? { name: k, qty: 0, amount: 0 };
      e.qty += Number(i.qty);
      e.amount += Number(i.total);
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount).slice(0, 20);
  }, [saleItems]);

  const gstr1 = useMemo(() => {
    // Group by GST rate
    const m = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }>();
    for (const i of saleItems as any[]) {
      const rate = Number(i.gst_rate) || 0;
      // Sale prices are stored as GST-inclusive amounts. Report taxable value
      // and GST from the actual saved line total, not by adding GST on top.
      const lineTotal = Math.max(0, Number(i.total) || (Number(i.qty || 0) * Number(i.price || 0) - Number(i.discount || 0)));
      const taxable = rate > 0 ? lineTotal / (1 + rate / 100) : lineTotal;
      const gst = Math.max(0, lineTotal - taxable);
      const e = m.get(rate) ?? { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
      e.taxable += taxable;
      e.cgst += gst / 2;
      e.sgst += gst / 2;
      e.total += taxable + gst;
      m.set(rate, e);
    }
    return Array.from(m.values()).sort((a, b) => a.rate - b.rate);
  }, [saleItems]);

  const stockValuation = useMemo(() => {
    let costVal = 0, mrpVal = 0;
    for (const p of products as any[]) {
      costVal += Number(p.stock) * Number(p.purchase_price ?? 0);
      mrpVal += Number(p.stock) * Number(p.mrp ?? 0);
    }
    return { costVal, mrpVal, count: products.length };
  }, [products]);

  const exportCsv = (rows: any[], name: string) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${from}-to-${to}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Reports</h1>
          <p className="text-sm text-muted-foreground">Sales, GSTR-1 summary, top products and stock valuation.</p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Sales</div><div className="text-2xl font-display font-bold">{inr(totals.total)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">GST Collected</div><div className="text-2xl font-display font-bold">{inr(totals.tax)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Bills</div><div className="text-2xl font-display font-bold">{totals.bills}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Stock @ Cost / MRP</div><div className="text-lg font-display font-bold">{inr(stockValuation.costVal)} / {inr(stockValuation.mrpVal)}</div></Card>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily Sales</TabsTrigger>
          <TabsTrigger value="gstr1">GSTR-1 Summary</TabsTrigger>
          <TabsTrigger value="top">Top Products</TabsTrigger>
          <TabsTrigger value="stock">Stock Valuation</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <Card>
            <div className="flex justify-end p-2"><Button size="sm" variant="outline" onClick={() => exportCsv(dailySummary, "daily-sales")}><Download className="h-4 w-4 mr-1" /> CSV</Button></div>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Bills</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {dailySummary.map((d) => (
                  <TableRow key={d.date}><TableCell>{d.date}</TableCell><TableCell>{d.bills}</TableCell><TableCell className="text-right font-mono">{inr(d.tax)}</TableCell><TableCell className="text-right font-mono font-semibold">{inr(d.total)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="gstr1">
          <Card>
            <div className="flex justify-end p-2"><Button size="sm" variant="outline" onClick={() => exportCsv(gstr1, "gstr1")}><Download className="h-4 w-4 mr-1" /> CSV</Button></div>
            <Table>
              <TableHeader><TableRow><TableHead>GST Rate</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {gstr1.map((g) => (
                  <TableRow key={g.rate}><TableCell>{g.rate}%</TableCell><TableCell className="text-right font-mono">{inr(g.taxable)}</TableCell><TableCell className="text-right font-mono">{inr(g.cgst)}</TableCell><TableCell className="text-right font-mono">{inr(g.sgst)}</TableCell><TableCell className="text-right font-mono font-semibold">{inr(g.total)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="top">
          <Card>
            <div className="flex justify-end p-2"><Button size="sm" variant="outline" onClick={() => exportCsv(topProducts, "top-products")}><Download className="h-4 w-4 mr-1" /> CSV</Button></div>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty Sold</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
              <TableBody>
                {topProducts.map((p) => (
                  <TableRow key={p.name}><TableCell>{p.name}</TableCell><TableCell className="text-right font-mono">{p.qty}</TableCell><TableCell className="text-right font-mono font-semibold">{inr(p.amount)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="stock">
          <Card>
            <div className="flex justify-end p-2"><Button size="sm" variant="outline" onClick={() => exportCsv(products as any[], "stock")}><Download className="h-4 w-4 mr-1" /> CSV</Button></div>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">MRP</TableHead><TableHead className="text-right">Stock Value</TableHead></TableRow></TableHeader>
              <TableBody>
                {(products as any[]).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right">{p.stock}</TableCell>
                    <TableCell className="text-right font-mono">{inr(p.purchase_price)}</TableCell>
                    <TableCell className="text-right font-mono">{inr(p.mrp)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{inr(Number(p.stock) * Number(p.purchase_price ?? 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
