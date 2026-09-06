import { isDesktopPrintingAvailable } from "@/lib/printer-prefs";

const DEFAULT_TEMPLATE =
  "Hi {customer}, thank you for shopping at {shop}! Your bill {invoice} of {total} is attached. Visit again!";

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

// Normalizes a phone number for wa.me: digits only, prefixing the shop's
// default country code when the number looks like a local 10-digit mobile
// number without one already.
export function normalizeWhatsAppPhone(raw: string, countryCode: string | null | undefined): string {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length <= 10) return `${(countryCode || "91").replace(/[^\d]/g, "")}${digits}`;
  return digits;
}

export type SendReceiptResult = { success: boolean; mode: "desktop-browser" | "web-text-only"; errorType?: string };

// Sends the bill over WhatsApp.
// - Desktop (Electron): captures the receipt as an image (copied to the
//   clipboard) and opens the customer's WhatsApp Web chat, with the message
//   pre-filled, in the user's own default browser on this PC — the cashier
//   pastes (Ctrl+V) the image in and sends.
// - Web build: no OS clipboard/screenshot access, so it just opens
//   web.whatsapp.com with the chat and message text pre-filled.
export async function sendReceiptOnWhatsApp(opts: {
  html: string;
  phone: string;
  message: string;
  paperSize?: "58mm" | "80mm" | "A4";
}): Promise<SendReceiptResult> {
  const widthPx = opts.paperSize === "58mm" ? 260 : opts.paperSize === "A4" ? 794 : 360;

  if (isDesktopPrintingAvailable() && window.electronAPI?.sendReceiptWhatsAppWeb) {
    try {
      const res = await window.electronAPI.sendReceiptWhatsAppWeb(opts.html, opts.phone, opts.message, widthPx);
      return { success: !!res?.success, mode: "desktop-browser", errorType: res?.errorType };
    } catch (err: any) {
      return { success: false, mode: "desktop-browser", errorType: String(err?.message || err) };
    }
  }

  const digits = opts.phone.replace(/[^\d]/g, "");
  if (!digits) return { success: false, mode: "web-text-only", errorType: "missing-phone" };
  const url = `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(opts.message)}`;
  window.open(url, "_blank");
  return { success: true, mode: "web-text-only" };
}

// Opens WhatsApp Web in the user's own default browser on this PC, so they
// can log in (scan the QR code) there once — same as opening
// web.whatsapp.com in any ordinary browser tab.
export async function openWhatsAppWeb(): Promise<{ success: boolean; errorType?: string }> {
  if (isDesktopPrintingAvailable() && window.electronAPI?.openWhatsAppWeb) {
    try {
      return await window.electronAPI.openWhatsAppWeb();
    } catch (err: any) {
      return { success: false, errorType: String(err?.message || err) };
    }
  }
  window.open("https://web.whatsapp.com", "_blank");
  return { success: true };
}
