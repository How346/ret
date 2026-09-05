import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ScanBarcode, ShieldCheck, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (session) void nav({ to: "/pos", replace: true });
  }, [session, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    if (pw.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      toast.error("Enter your name");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const result = await withTimeout(
          supabase.auth.signInWithPassword({ email: cleanEmail, password: pw }),
          10000,
          "Local login timed out. Please restart the app and try again."
        );
        if (result.error) throw result.error;
        toast.success("Welcome back");
      } else {
        const result = await withTimeout(
          supabase.auth.signUp({
            email: cleanEmail,
            password: pw,
            options: { data: { full_name: name.trim() } },
          }),
          10000,
          "Account creation timed out. Please restart the app and try again."
        );
        if (result.error) throw result.error;
        toast.success("Local account created");
        // The offline auth implementation signs the user in immediately.
        // If a different auth implementation returns no session, switch back
        // to sign-in instead of leaving the form in an ambiguous state.
        if (!result.data?.session) {
          setMode("signin");
          setPw("");
        }
      }
    } catch (error: any) {
      if (mounted.current) toast.error(error?.message ?? "Authentication failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-display font-bold text-lg">M</div>
          <div className="font-display text-xl font-bold">Margin ERP</div>
        </div>
        <div className="relative z-10 space-y-4 max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight">Bill faster.<br />Stock smarter.<br />Stay GST-ready.</h1>
          <p className="text-sidebar-foreground/70">A keyboard-first POS, inventory and accounting system built for Indian retail and wholesale.</p>
          <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
            {["Barcode billing", "GST invoicing", "Multi-pricing", "Stock alerts", "Hold & recall", "Daily reports"].map(f => (
              <div key={f} className="flex items-center gap-2 text-sidebar-foreground/80">
                <div className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" /> {f}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
          <WifiOff className="h-3.5 w-3.5" /> 100% local · No cloud login
        </div>
        <div className="absolute -right-32 -bottom-32 w-96 h-96 rounded-full bg-sidebar-primary/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8">
          <div className="lg:hidden mb-6 flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-primary" />
            <span className="font-display font-bold">Margin ERP</span>
          </div>

          <div className="mb-5 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> Offline account</div>
            <p className="mt-1 text-xs text-muted-foreground">Your account and ERP data stay on this PC. Internet is not required.</p>
          </div>

          <h2 className="font-display text-2xl font-bold">{mode === "signin" ? "Sign in" : "Create account"}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Sign in to the account stored on this PC." : "Create the first local account for this PC."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" disabled={busy} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@store.com" disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={6} value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 6 characters" disabled={busy} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create local account"}
            </Button>
          </form>

          <button type="button" disabled={busy} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setPw(""); }} className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            {mode === "signin" ? "No account yet? Create one →" : "Already have an account? Sign in →"}
          </button>
        </Card>
      </div>
    </div>
  );
}

async function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
