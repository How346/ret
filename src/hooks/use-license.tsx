import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type License = {
  id: string;
  key: string;
  user_id: string | null;
  plan: string;
  issued_at: string;
  expires_at: string;
  status: string;
  notes: string | null;
};

export function useMyLicense() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-license", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("licenses")
        .select("*")
        .eq("user_id", user!.id)
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as License | null;
    },
  });
}

export function licenseStatus(l: License | null | undefined) {
  if (!l) return { valid: false, reason: "none" as const, daysLeft: 0 };
  if (l.status !== "active") return { valid: false, reason: "revoked" as const, daysLeft: 0 };
  const exp = new Date(l.expires_at).getTime();
  const daysLeft = Math.ceil((exp - Date.now()) / (1000 * 60 * 60 * 24));
  if (exp < Date.now()) return { valid: false, reason: "expired" as const, daysLeft: 0 };
  return { valid: true, reason: "ok" as const, daysLeft };
}

export async function redeemLicenseKey(key: string, userId: string) {
  const clean = key.trim().toUpperCase();
  const { data, error } = await supabase
    .from("licenses")
    .update({ user_id: userId })
    .eq("key", clean)
    .is("user_id", null)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Invalid or already-used license key");
  return data as License;
}
