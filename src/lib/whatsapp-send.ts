import html2canvas from "html2canvas";
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
  errorType?: string;
};

async function renderBillImageDataUrl(html: string, widthPx: number): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  const host = document.createElement("div");
  const width = Math.max(280, Math.min(1200, Number(widthPx) || 380));

  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.maxWidth = `${width}px`;
  host.style.background = "#fff";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  host.style.overflow = "visible";

  for (const style of Array.from(doc.head.querySelectorAll("style"))) host.appendChild(style.cloneNode(true));
  for (const link of Array.from(doc.head.querySelectorAll('link[rel="stylesheet"]'))) {
    try { host.appendChild(link.cloneNode(true)); } catch { /* ignore */ }
  }
  if (doc.body) host.append(...Array.from(doc.body.childNodes).map((node) => node.cloneNode(true)));
  document.body.appendChild(host);

  try {
    const images = Array.from(host.querySelectorAll("img"));
    await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    })));
    try { await document.fonts.ready; } catch { /* ignore */ }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const canvas = await html2canvas(host, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width,
      windowWidth: width,
      scrollX: 0,
      scrollY: 0,
    });
    try {
      return canvas.toDataURL("image/png");
    } catch {
      host.querySelectorAll("img").forEach((img) => img.remove());
      const retry = await html2canvas(host, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        windowWidth: width,
        scrollX: 0,
        scrollY: 0,
      });
      return retry.toDataURL("image/png");
    }
  } finally {
    host.remove();
  }
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
      const res = await window.electronAPI.sendBillImage(base64, opts.phone, "");
      return {
        success: !!res?.success,
        mode: "background-whatsapp",
        imaged: !!res?.success,
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
