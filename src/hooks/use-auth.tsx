import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  user: null,
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    // The offline client emits its initial session asynchronously. Do not wait
    // for a role query before allowing the app/router to leave the loading state.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (disposed) return;
      setSession(next);
      if (!next) {
        setRole(null);
        return;
      }

      // Role is secondary UI information. Resolve it in the background so a
      // slow local database can never trap the user on the login screen.
      setRole((current) => current ?? "cashier");
      window.setTimeout(async () => {
        if (disposed) return;
        try {
          const { data } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", next.user.id)
            .order("role", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!disposed && data?.role) setRole(data.role as Role);
        } catch (error) {
          console.warn("[auth] local role lookup failed:", error);
        }
      }, 0);
    });

    // Initial auth state is local-only in the Electron build. Always clear the
    // loading gate even if an unexpected local-storage/database error occurs.
    Promise.resolve()
      .then(() => supabase.auth.getSession())
      .then(({ data: { session: next } }) => {
        if (disposed) return;
        setSession(next);
        setRole(next ? "cashier" : null);
        setLoading(false);
      })
      .catch((error) => {
        console.error("[auth] session initialization failed:", error);
        if (!disposed) {
          setSession(null);
          setRole(null);
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user: session?.user ?? null,
    session,
    role,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setSession(null);
      setRole(null);
    },
  }), [session, role, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
