import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, KeyRound, ShieldCheck, ShieldX, Copy, Plus, Trash2, RefreshCw, Store as StoreIcon, MonitorDown, ExternalLink, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_app/admin")({ component: AdminPanel });

function AdminPanel() {
  const { role, loading } = useAuth();
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (role !== "admin") return <Navigate to="/dashboard" />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Manage users, roles and software licenses</p>
      </div>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1" /> Users</TabsTrigger>
          <TabsTrigger value="licenses"><KeyRound className="h-3.5 w-3.5 mr-1" /> Licenses</TabsTrigger>
          <TabsTrigger value="stores"><StoreIcon className="h-3.5 w-3.5 mr-1" /> Stores</TabsTrigger>
          <TabsTrigger value="offline"><MonitorDown className="h-3.5 w-3.5 mr-1" /> Offline Desktop</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="licenses" className="mt-4"><LicensesTab /></TabsContent>
        <TabsContent value="stores" className="mt-4"><StoresTab /></TabsContent>
        <TabsContent value="offline" className="mt-4"><OfflineDesktopTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------- USERS -------------------- */

type ProfileRow = { id: string; full_name: string | null; is_blocked: boolean; created_at: string; store_id: string | null };
type RoleRow = { user_id: string; role: "admin" | "manager" | "cashier" };
type StoreRow = { id: string; name: string; notes: string | null; created_at: string };

function UsersTab() {
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("profiles").select("id,full_name,is_blocked,created_at,store_id").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id,role");
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
  });

  const { data: stores = [] } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("stores").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const roleFor = (uid: string) => roles.find(r => r.user_id === uid)?.role ?? "cashier";

  const setStore = async (uid: string, storeId: string | null) => {
    const { error } = await (supabase as any).from("profiles").update({ store_id: storeId }).eq("id", uid);
    if (error) return toast.error(error.message);
    toast.success("Store assigned");
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  const toggleBlock = async (u: ProfileRow) => {
    const { error } = await supabase.from("profiles").update({ is_blocked: !u.is_blocked }).eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success(u.is_blocked ? "User unblocked" : "User blocked");
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  const setRole = async (uid: string, role: RoleRow["role"]) => {
    await supabase.from("user_roles").delete().eq("user_id", uid);
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["admin-roles"] });
  };

  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr><th className="text-left py-2">Name / ID</th><th className="text-left">Role</th><th className="text-left">Store</th><th className="text-left">Status</th><th className="text-right">Actions</th></tr>
        </thead>
        <tbody>
          {profiles.map(u => (
            <tr key={u.id} className="border-b hover:bg-muted/30">
              <td className="py-2">
                <div className="font-medium">{u.full_name ?? "—"}</div>
                <div className="text-[11px] font-mono text-muted-foreground">{u.id}</div>
              </td>
              <td>
                <Select value={roleFor(u.id)} onValueChange={v => setRole(u.id, v as RoleRow["role"])}>
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="cashier">Cashier</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td>
                <Select value={u.store_id ?? "none"} onValueChange={v => setStore(u.id, v === "none" ? null : v)}>
                  <SelectTrigger className="h-8 w-40"><SelectValue placeholder="— none —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </td>
              <td>{u.is_blocked ? <Badge variant="destructive">Blocked</Badge> : <Badge variant="secondary">Active</Badge>}</td>
              <td className="text-right">
                <Button size="sm" variant={u.is_blocked ? "outline" : "destructive"} onClick={() => toggleBlock(u)}>
                  {u.is_blocked ? <><ShieldCheck className="h-3.5 w-3.5 mr-1" /> Unblock</> : <><ShieldX className="h-3.5 w-3.5 mr-1" /> Block</>}
                </Button>
              </td>
            </tr>
          ))}
          {!profiles.length && <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No users yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

/* -------------------- LICENSES -------------------- */

type LicenseRow = {
  id: string; key: string; user_id: string | null; plan: string;
  issued_at: string; expires_at: string; status: string; notes: string | null;
};

function genKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `LMPOS-${seg()}-${seg()}-${seg()}-${seg()}`;
}

function LicensesTab() {
  const qc = useQueryClient();
  const [genOpen, setGenOpen] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-licenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("licenses").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LicenseRow[];
    },
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name");
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const nameFor = (uid: string | null) => uid ? (profiles.find(p => p.id === uid)?.full_name ?? uid.slice(0, 8)) : "— unassigned —";

  const revoke = async (id: string) => {
    if (!confirm("Revoke this license?")) return;
    await supabase.from("licenses").update({ status: "revoked" }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-licenses"] });
  };
  const extend = async (id: string, days: number) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const base = Math.max(Date.now(), new Date(row.expires_at).getTime());
    const next = new Date(base + days * 86400_000).toISOString();
    await supabase.from("licenses").update({ expires_at: next, status: "active" }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-licenses"] });
    toast.success(`Extended by ${days} days`);
  };
  const del = async (id: string) => {
    if (!confirm("Delete this license row?")) return;
    await supabase.from("licenses").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-licenses"] });
  };
  const copy = (k: string) => { navigator.clipboard.writeText(k); toast.success("Key copied"); };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">Generate keys to share with users. They enter it on the license popup or in Settings.</div>
        <Button onClick={() => setGenOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Generate key</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr><th className="text-left py-2">Key</th><th className="text-left">Assigned to</th><th className="text-left">Plan</th><th className="text-left">Expires</th><th className="text-left">Status</th><th className="text-right">Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const expired = new Date(r.expires_at).getTime() < Date.now();
            return (
              <tr key={r.id} className="border-b hover:bg-muted/30">
                <td className="py-2 font-mono text-xs">
                  <button onClick={() => copy(r.key)} className="hover:underline flex items-center gap-1">
                    {r.key} <Copy className="h-3 w-3" />
                  </button>
                </td>
                <td>{nameFor(r.user_id)}</td>
                <td>{r.plan}</td>
                <td className="text-xs">{new Date(r.expires_at).toLocaleDateString()}</td>
                <td>
                  {r.status === "revoked" ? <Badge variant="destructive">Revoked</Badge>
                    : expired ? <Badge variant="outline">Expired</Badge>
                    : <Badge variant="secondary">Active</Badge>}
                </td>
                <td className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => extend(r.id, 30)}><RefreshCw className="h-3 w-3 mr-1" />+30d</Button>
                  <Button size="sm" variant="outline" onClick={() => extend(r.id, 365)}>+1y</Button>
                  {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => revoke(r.id)}>Revoke</Button>}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No licenses yet.</td></tr>}
        </tbody>
      </table>

      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} profiles={profiles} onDone={() => qc.invalidateQueries({ queryKey: ["admin-licenses"] })} />
    </Card>
  );
}

function GenerateDialog({ open, onOpenChange, profiles, onDone }: {
  open: boolean; onOpenChange: (b: boolean) => void;
  profiles: { id: string; full_name: string | null }[]; onDone: () => void;
}) {
  const [plan, setPlan] = useState("standard");
  const [days, setDays] = useState(365);
  const [userId, setUserId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    try {
      const key = genKey();
      const expires = new Date(Date.now() + days * 86400_000).toISOString();
      const { data, error } = await supabase.from("licenses").insert({
        key, plan, expires_at: expires,
        user_id: userId || null, notes: notes || null,
      }).select().maybeSingle();
      if (error) {
        console.error("License insert failed", error);
        toast.error(`Insert failed: ${error.message}${error.hint ? " — " + error.hint : ""}`);
        return;
      }
      if (!data) {
        toast.error("Insert returned no row — check that your account has the Admin role.");
        return;
      }
      setIssued(key);
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Unexpected error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setIssued(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Generate license key</DialogTitle></DialogHeader>
        {issued ? (
          <div className="space-y-3">
            <p className="text-sm">Share this key with the user:</p>
            <div className="rounded border bg-muted p-3 font-mono text-center break-all">{issued}</div>
            <Button className="w-full" onClick={() => { navigator.clipboard.writeText(issued); toast.success("Copied"); }}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy key
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label>Plan</Label><Input value={plan} onChange={e => setPlan(e.target.value)} /></div>
            <div><Label>Validity (days)</Label><Input type="number" value={days} onChange={e => setDays(Number(e.target.value) || 0)} /></div>
            <div>
              <Label>Assign to (optional)</Label>
              <Select value={userId || "none"} onValueChange={v => setUserId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned — user redeems by key" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— unassigned (user redeems) —</SelectItem>
                  {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 8)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          {!issued && <Button onClick={submit} disabled={saving}>{saving ? "Generating…" : "Generate"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- OFFLINE DESKTOP -------------------- */

function OfflineDesktopTab() {
  const [downloadUrl, setDownloadUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDownloadUrl(localStorage.getItem("merp-offline-download-url") ?? "");
  }, []);

  const saveUrl = () => {
    const value = downloadUrl.trim();
    if (value) localStorage.setItem("merp-offline-download-url", value);
    else localStorage.removeItem("merp-offline-download-url");
    setDownloadUrl(value);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const openDownload = () => {
    if (!downloadUrl) {
      toast.error("Save the Windows download link first");
      return;
    }
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary"><MonitorDown className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold">Offline Windows desktop</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Download the single-PC version for billing, products, purchases, stock, sales, printing and reports without internet.
            </p>
          </div>
        </div>

        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm space-y-2">
          <div className="font-medium">How to publish a new Windows build</div>
          <ol className="list-decimal list-inside text-muted-foreground space-y-1">
            <li>Run the GitHub Actions workflow named <b>Build Margin ERP Offline for Windows</b>.</li>
            <li>Download the <b>MarginERP-Offline-Windows</b> artifact, or use the tagged release asset.</li>
            <li>Extract the ZIP and open the application on the shop computer.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <Label htmlFor="offline-download-url">Windows download link</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="offline-download-url"
              value={downloadUrl}
              onChange={(event) => setDownloadUrl(event.target.value)}
              placeholder="Paste the GitHub Actions artifact or release URL"
            />
            <Button variant="outline" onClick={saveUrl}>{saved ? "Saved" : "Save link"}</Button>
            <Button onClick={openDownload} disabled={!downloadUrl}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Download
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">This link is saved only in this browser for Admin access. It does not alter the online billing app.</p>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4" /> Important data notes</h2>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          <li>The offline build stores its data locally on the Windows computer; it does not sync with the online store.</li>
          <li>Use Settings → Store Data to choose a backup folder and create regular JSON backups.</li>
          <li>AI barcode enrichment and other internet-only services are unavailable offline; barcode and product details can be entered manually.</li>
          <li>Keep the backup folder and the downloaded ZIP in a safe location before changing computers.</li>
        </ul>
      </Card>
    </div>
  );
}

/* -------------------- STORES -------------------- */

function StoresTab() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-stores-full"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("stores").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StoreRow[];
    },
  });

  const create = async () => {
    if (!name.trim()) return toast.error("Store name required");
    setSaving(true);
    const { error } = await (supabase as any).from("stores").insert({ name: name.trim(), notes: notes.trim() || null });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Store created — its data is separate from other stores.");
    setName(""); setNotes("");
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
    qc.invalidateQueries({ queryKey: ["admin-stores-full"] });
  };

  const rename = async (id: string, curr: string) => {
    const v = prompt("New name", curr);
    if (!v) return;
    const { error } = await (supabase as any).from("stores").update({ name: v }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
    qc.invalidateQueries({ queryKey: ["admin-stores-full"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this store? Users assigned to it will be unassigned. Rows linked to it will lose their store link.")) return;
    const { error } = await (supabase as any).from("stores").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
    qc.invalidateQueries({ queryKey: ["admin-stores-full"] });
    qc.invalidateQueries({ queryKey: ["admin-profiles"] });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm text-muted-foreground">
          Each store keeps its own products, customers, sales, purchases and suppliers.
          Assign users to a store in the <b>Users</b> tab — they'll only see that store's data.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Store name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Branch 2 — Delhi" /></div>
          <div className="md:col-span-2"><Label>Notes (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <Button onClick={create} disabled={saving}><Plus className="h-3.5 w-3.5 mr-1" /> {saving ? "Creating…" : "Create store"}</Button>
      </Card>

      <Card className="p-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr><th className="text-left py-2">Name</th><th className="text-left">Notes</th><th className="text-left">Created</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} className="border-b hover:bg-muted/30">
                <td className="py-2 font-medium">{s.name}</td>
                <td className="text-muted-foreground">{s.notes ?? "—"}</td>
                <td className="text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => rename(s.id, s.name)}>Rename</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No stores yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

