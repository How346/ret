import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useMyLicense, licenseStatus, redeemLicenseKey } from "@/hooks/use-license";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, LogOut } from "lucide-react";

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const { data: license, isLoading } = useMyLicense();
  const status = licenseStatus(license);
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  // Admins bypass the gate entirely (so they can generate keys)
  if (role === "admin") return <>{children}</>;
  if (isLoading) return <>{children}</>;
  if (status.valid) return <>{children}</>;

  const reason =
    status.reason === "expired" ? "Your license has expired." :
    status.reason === "revoked" ? "Your license has been revoked." :
    "No active license found for this account.";

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
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{reason} Enter a renewal key given by your admin to continue.</p>
            <Input
              placeholder="LMPOS-XXXX-XXXX-XXXX-XXXX"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || !key.trim() || !user}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await redeemLicenseKey(key, user!.id);
                    toast.success("License activated");
                    qc.invalidateQueries({ queryKey: ["my-license"] });
                  } catch (e: any) {
                    toast.error(e.message ?? "Invalid key");
                  } finally { setBusy(false); }
                }}
              >
                {busy ? "Activating…" : "Activate"}
              </Button>
              <Button variant="outline" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-1" /> Sign out
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
