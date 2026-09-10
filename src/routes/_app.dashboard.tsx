import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { inr } from "@/lib/format";
import { ReceiptText, Package, AlertTriangle, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const [sales, products] = await Promise.all([
        supabase.from("sales").select("total,created_at").gte("created_at", today.toISOString()),
        supabase.from("products").select("stock,low_stock_alert,sale_price"),
      ]);
      const todayTotal = (sales.data ?? []).reduce((s, x) => s + Number(x.total), 0);
      const billCount = sales.data?.length ?? 0;
      const productCount = products.data?.length ?? 0;
      const lowStock = (products.data ?? []).filter(p => Number(p.stock) <= Number(p.low_stock_alert)).length;
      return { todayTotal, billCount, productCount, lowStock };
    },
  });

  const stats = [
    { label: "Today's Sales", value: inr(data?.todayTotal ?? 0), icon: TrendingUp, color: "text-success" },
    { label: "Bills Today", value: String(data?.billCount ?? 0), icon: ReceiptText, color: "text-primary" },
    { label: "Products", value: String(data?.productCount ?? 0), icon: Package, color: "text-accent-foreground" },
    { label: "Low Stock", value: String(data?.lowStock ?? 0), icon: AlertTriangle, color: "text-destructive" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Today at a glance</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
                <div className="font-display text-2xl font-bold mt-2">{s.value}</div>
              </div>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
