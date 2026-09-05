import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  // Keep text entry out of React render state. This is important for Electron:
  // authentication/data initialization must never interrupt native keyboard input.
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session) nav({ to: "/pos" }); }, [session, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: emailRef.current?.value ?? "", password: pwRef.current?.value ?? "" });
        if (error) throw error;
        toast.success("Welcome back");
      } else {
        const { error } = await supabase.auth.signUp({
          email: emailRef.current?.value ?? "", password: pwRef.current?.value ?? "",
          options: {
            emailRedirectTo: `${window.location.origin}/pos`,
            data: { full_name: nameRef.current?.value?.trim() || emailRef.current?.value?.trim() || "User" },
          },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-display font-bold text-lg">M</div>
          <div className="font-display text-xl font-bold">Margin ERP</div>
        </div>
        <div className="relative z-10 space-y-4 max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight">
            Bill faster.<br />Stock smarter.<br />Stay GST-ready.
          </h1>
          <p className="text-sidebar-foreground/70">
            A keyboard-first POS, inventory and accounting system built for Indian retail and wholesale.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
            {["Barcode billing", "GST invoicing", "Multi-pricing", "Stock alerts", "Hold & recall", "Daily reports"].map(f => (
              <div key={f} className="flex items-center gap-2 text-sidebar-foreground/80">
                <div className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" /> {f}
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-sidebar-foreground/50">v1.0 · Powered by Lovable Cloud</div>
        <div className="absolute -right-32 -bottom-32 w-96 h-96 rounded-full bg-sidebar-primary/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8">
          <div className="lg:hidden mb-6 flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-primary" />
            <span className="font-display font-bold">Margin ERP</span>
          </div>
          <h2 className="font-display text-2xl font-bold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Welcome back to your store." : "First account becomes admin."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" ref={nameRef} placeholder="Your name" autoComplete="name" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" ref={emailRef} type="email" required placeholder="you@store.com" autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" ref={pwRef} type="password" required minLength={6} placeholder="••••••••" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "No account yet? Create one →"
              : "Already have an account? Sign in →"}
          </button>
        </Card>
      </div>
    </div>
  );
}
