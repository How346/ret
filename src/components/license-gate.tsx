import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useMyLicense, licenseStatus, redeemLicenseKey } from "@/hooks/use-license";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, LogOut, Upload, Copy, HardDrive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const { data: license, isLoading } = useMyLicense();
  const status = licenseStatus(license);
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [hwid, setHwid] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = !!window.electronAPI?.installLicense;

  // The web/Supabase admin path remains available. Offline desktop licensing
  // is handled locally by the signed licence.lic verifier in Electron.
  if (!offline && (supabase as any).__offline) return <>{children}</>;
  if (!offline && role === "admin") return <>{children}</>;
  if (isLoading) return <>{children}</>;
  if (status.valid) return <>{children}</>;

  const loadHwid = async () => {
    if (!window.electronAPI?.getHWID) return;
    const result = await window.electronAPI.getHWID();
    setHwid(result.hwid);
  };

  const installFile = async (file: File) => {
    if (!window.electronAPI?.installLicense) return;
    setBusy(true);
    try {
      const text = await file.text();
      const result = await window.electronAPI.installLicense(text);
      if (!result.valid) throw new Error(result.reason || "Invalid license");
      toast.success("License activated successfully");
      await qc.invalidateQueries({ queryKey: ["my-license"] });
    } catch (e: any) {
      toast.error(e?.message || "Invalid license file");
    } finally {
      setBusy(false);
    }
  };

  const reason =
    status.reason === "expired" ? "Your license has expired." :
    status.reason === "revoked" ? "Your license has been revoked." :
    "No active license is installed on this computer.";

  return (
    <>
      {children}
      <Dialog open onOpenChange={() => {}}>
        <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" /> License required
            </DialogTitle>
          </DialogHeader>

          {offline ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{reason} Upload the signed <span className="font-mono">licence.lic</span> generated for this computer.</p>

              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <HardDrive className="h-3.5 w-3.5" /> Hardware ID (HWID)
                </div>
                <div className="flex gap-2">
                  <Input readOnly value={hwid} placeholder="Click Show HWID" className="font-mono text-xs" />
                  <Button variant="outline" onClick={async () => { await loadHwid(); }}>
                    Show
                  </Button>
                </div>
                {hwid && <Button variant="ghost" size="sm" className="px-0" onClick={() => { navigator.clipboard.writeText(hwid); toast.success("HWID copied"); }}><Copy className="h-3.5 w-3.5 mr-1" /> Copy HWID</Button>}
              </div>

              <input ref={fileRef} type="file" accept=".lic,application/octet-stream,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void installFile(f); e.currentTarget.value = ""; }} />
              <Button className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> {busy ? "Verifying…" : "Upload licence.lic"}
              </Button>

              <p className="text-[11px] text-muted-foreground">Verification happens locally. The private signing key is never included in this application.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{reason} Enter a renewal key given by your admin to continue.</p>
              <Input placeholder="LMPOS-XXXX-XXXX-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-mono" />
              <div className="flex gap-2">
                <Button className="flex-1" disabled={busy || !key.trim() || !user} onClick={async () => {
                  setBusy(true);
                  try { await redeemLicenseKey(key, user!.id); toast.success("License activated"); qc.invalidateQueries({ queryKey: ["my-license"] }); setKey(""); }
                  catch (e: any) { toast.error(e.message ?? "Invalid key"); }
                  finally { setBusy(false); }
                }}>{busy ? "Activating…" : "Activate"}</Button>
                <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4 mr-1" /> Sign out</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
