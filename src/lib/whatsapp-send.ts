import { isDesktopPrintingAvailable } from "@/lib/printer-prefs";

const DEFAULT_TEMPLATE =
  "Hi {customer}, thank you for shopping at {shop}! Your bill {invoice} of {total} is attached. Visit again!";

const WHATSAPP_BROWSER_KEY = "margin-erp:whatsapp-browser";

export type WhatsAppBrowser = { id: string; name: string };

export function fillWhatsAppTemplate(
  template: string | null | undefined,
  vars: { customer: string; shop: string; invoice: string; total: string },
): string {
  const t = template && template.trim() ? template : DEFAULT_TEMPLATE;
  return t
    .replace(/\{customer\}/g, vars.customer)
    .replace(/\{shop\}/g, vars.shop)
    .replace(/\{invoice\}/g, vars.invoice)
    .replace(/\{total\}/g, vars.total);
}

export function normalizeWhatsAppPhone(raw: string, countryCode: string | null | undefined): string {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length <= 10) return `${(countryCode || "91").replace(/[^\d]/g, "")}${digits}`;
  return digits;
}

export function getWhatsAppBrowserPreference(): string {
  try {
    return localStorage.getItem(WHATSAPP_BROWSER_KEY) || "default";
  } catch {
    return "default";
  }
}

export function setWhatsAppBrowserPreference(browserId: string) {
  try {
    localStorage.setItem(WHATSAPP_BROWSER_KEY, browserId || "default");
  } catch {
    /* ignore */
  }
}

export async function listWhatsAppBrowsers(): Promise<WhatsAppBrowser[]> {
  if (typeof window !== "undefined" && window.electronAPI?.listWhatsAppBrowsers) {
    try {
      return (await window.electronAPI.listWhatsAppBrowsers()) || [];
    } catch {
      return [{ id: "default", name: "System default browser" }];
    }
  }
  return [{ id: "default", name: "System default browser" }];
}

export type SendReceiptResult = {
  success: boolean;
  mode: "external-browser" | "web-text-only";
  errorType?: string;
};

export async function sendReceiptOnWhatsApp(opts: {
  html: string;
  phone: string;
  countryCode?: string | null;
  message: string;
  paperSize?: "58mm" | "80mm" | "A4";
}): Promise<SendReceiptResult> {
  const widthPx = opts.paperSize === "58mm" ? 260 : opts.paperSize === "A4" ? 794 : 360;
  const browserId = getWhatsAppBrowserPreference();
  const phone = normalizeWhatsAppPhone(opts.phone, opts.countryCode);

  if (!phone) return { success: false, mode: "external-browser", errorType: "missing-phone" };

  if (isDesktopPrintingAvailable() && window.electronAPI?.sendReceiptWhatsAppWeb) {
    try {
      const res = await window.electronAPI.sendReceiptWhatsAppWeb(
        opts.html,
        phone,
        opts.message,
        widthPx,
        browserId,
      );
      return { success: !!res?.success, mode: "external-browser", errorType: res?.errorType };
    } catch (err: any) {
      return { success: false, mode: "external-browser", errorType: String(err?.message || err) };
    }
  }

  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(opts.message)}`;
  window.open(url, "_blank");
  return { success: true, mode: "web-text-only" };
}

export async function openWhatsAppWeb(): Promise<{ success: boolean; errorType?: string }> {
  const browserId = getWhatsAppBrowserPreference();

  if (isDesktopPrintingAvailable() && window.electronAPI?.openWhatsAppWeb) {
    try {
      return await window.electronAPI.openWhatsAppWeb(browserId);
    } catch (err: any) {
      return { success: false, errorType: String(err?.message || err) };
    }
  }
  window.open("https://web.whatsapp.com", "_blank");
  return { success: true };
}
