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
  if (digits.length === 10) return `${(countryCode || "91").replace(/[^\d]/g, "")}${digits}`;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return `${(countryCode || "91").replace(/[^\d]/g, "")}${digits.slice(1)}`;
  return digits;
}

export type SendReceiptResult = {
  success: boolean;
  mode: "background-whatsapp" | "web-text-only";
  imaged?: boolean;
  messaged?: boolean;
  errorType?: string;
};

async function renderBillImageDataUrl(html: string, widthPx: number): Promise<string> {
  const width = Math.max(280, Math.min(1200, Number(widthPx) || 380));

  // IMPORTANT: render the exact receipt HTML in Electron's Chromium page and
  // capture that page. client-side canvas rendering was causing 1px/line-height and border
  // compositing artefacts (dashed separators appearing through text) on some
  // Windows builds. Chromium capturePage uses the same layout engine used for
  // printing, so the WhatsApp image now matches the real invoice layout.
  if (!window.electronAPI?.renderBillImage) {
    throw new Error("The desktop bill-image renderer is unavailable. Rebuild the Windows app with the latest version.");
  }

  const result = await window.electronAPI.renderBillImage(html, width);
  if (!result?.success || !result.imageDataUrl) {
    throw new Error(result?.errorType || "Could not render the complete bill image.");
  }
  return result.imageDataUrl;
}

export async function sendReceiptOnWhatsApp(opts: {
  html: string;
  phone: string;
  message?: string;
  paperSize?: "58mm" | "80mm" | "A4";
}): Promise<SendReceiptResult> {
  const widthPx = opts.paperSize === "58mm" ? 260 : opts.paperSize === "A4" ? 794 : 360;

  if (isDesktopPrintingAvailable() && window.electronAPI?.sendBillImage) {
    try {
      const imageDataUrl = await renderBillImageDataUrl(opts.html, widthPx);
      const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, "");
      const res = await window.electronAPI.sendBillImage(base64, opts.phone, opts.message || "");
      return {
        success: !!res?.success,
        mode: "background-whatsapp",
        imaged: !!res?.imaged || !!res?.success,
        messaged: !!res?.messaged,
        errorType: res?.errorType,
      };
    } catch (err: any) {
      return {
        success: false,
        mode: "background-whatsapp",
        errorType: String(err?.message || err),
      };
    }
  }

  return {
    success: false,
    mode: "web-text-only",
    errorType: "Background WhatsApp sending is available only in the Windows desktop app.",
  };
}
