import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PrintSettings } from "@/lib/print-receipt";

export type StoreSettings = PrintSettings & {
  id: string;
  invoice_prefix: string;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  receipt_font_size?: number;
  show_gst_breakdown?: boolean;
  bill_no_format?: "short" | "full";
  receipt_margin_top?: number;
  receipt_margin_bottom?: number;
  receipt_margin_left?: number;
  receipt_margin_right?: number;
  receipt_bold?: boolean;
  receipt_line_height?: number;
};

export function useStoreSettings() {
  return useQuery({
    queryKey: ["store_settings"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as StoreSettings | null;
    },
  });
}
