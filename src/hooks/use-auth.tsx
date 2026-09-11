import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "manager" | "cashier";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, role: null, loading: true, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe?: () => void } | null = null;

    const applySession = (s: Session | null) => {
      if (cancelled) return;
      setSession(s);
      setRole(null);
      if (s?.user) {
        // Role lookup must never be allowed to break application startup.
        setTimeout(() => {
          void (async () => {
            try {
              const result = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", s.user.id)
                .order("role", { ascending: true })
                .limit(1)
                .maybeSingle();
              if (!cancelled) setRole((result?.data?.role as Role) ?? "cashier");
            } catch (error) {
              console.error("[Margin ERP] offline role lookup failed", error);
              if (!cancelled) setRole("cashier");
            }
          })();
        }, 0);
      }
    };

    try {
      const result = supabase.auth.onAuthStateChange((_event: string, s: Session | null) => {
        applySession(s);
        if (!cancelled) setLoading(false);
      });
      subscription = result?.data?.subscription ?? null;
    } catch (error) {
      console.error("[Margin ERP] auth listener failed", error);
      if (!cancelled) {
        setSession(null);
        setRole(null);
        setLoading(false);
      }
    }

    void (async () => {
      try {
        const result = await supabase.auth.getSession();
        applySession(result?.data?.session ?? null);
      } catch (error) {
        console.error("[Margin ERP] auth startup failed", error);
        if (!cancelled) {
          setSession(null);
          setRole(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try { subscription?.unsubscribe?.(); } catch {}
    };
  }, []);

  return (
    <Ctx.Provider value={{
      user: session?.user ?? null,
      session,
      role,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
