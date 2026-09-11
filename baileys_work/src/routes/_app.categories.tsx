import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";

export const Route = createFileRoute("/_app/categories")({ component: CategoriesPage });

type Category = { id: string; name: string; created_at: string };

function CategoriesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const { data: counts = {} } = useQuery({
    queryKey: ["category-product-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("category_id");
      const m: Record<string, number> = {};
      for (const r of data ?? []) if (r.category_id) m[r.category_id] = (m[r.category_id] || 0) + 1;
      return m;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing?.name?.trim()) throw new Error("Name required");
      if (editing.id) {
        const { error } = await supabase.from("categories").update({ name: editing.name.trim() }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("categories").insert({ name: editing.name.trim() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["categories"] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6" /> Categories</h1>
          <p className="text-sm text-muted-foreground">Organise products into categories for fast lookup & reports.</p>
        </div>
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing({ name: "" })}><Plus className="h-4 w-4 mr-1" /> New category</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} category</DialogTitle></DialogHeader>
            <Label>Name</Label>
            <Input
              autoFocus
              value={editing?.name ?? ""}
              onChange={e => setEditing(c => ({ ...(c ?? {}), name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && !save.isPending) { e.preventDefault(); save.mutate(); } }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left py-2 px-3">Name</th>
              <th className="text-right py-2 px-3">Products</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                <td className="py-2 px-3 font-medium">{c.name}</td>
                <td className="py-2 px-3 text-right font-mono">{counts[c.id] ?? 0}</td>
                <td className="py-2 px-3 text-right">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                    onClick={() => setDeleteCategory(c)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="text-center py-12 text-muted-foreground">No categories yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
    <AlertDialog open={!!deleteCategory} onOpenChange={(open) => !open && setDeleteCategory(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete category?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently delete <strong>{deleteCategory?.name}</strong>. Products linked to this category may be affected.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={del.isPending} onClick={() => { if (deleteCategory) del.mutate(deleteCategory.id); setDeleteCategory(null); }}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
