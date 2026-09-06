import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_app/customers")({ component: Customers });

function Customers() {
  const { data: rows = [] } = useQuery({
    queryKey: ["customers-page"],
    queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
  });
  return (
    <div className="p-4 h-[calc(100vh-3rem)] flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Customers</h1>
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
              {rows.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No customers yet — add one from the POS screen.</td></tr>}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </div>
  );
}
