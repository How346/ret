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
  messaged?: boolean;
  errorType?: string;
};

async function renderBillImageDataUrl(html: string, widthPx: number): Promise<string> {
  const width = Math.max(280, Math.min(1200, Number(widthPx) || 380));
  const iframe = document.createElement("iframe");

  // Use a same-origin iframe so the original receipt's <html>/<body> CSS is
  // preserved exactly. This avoids the common html2canvas problem where a
  // cloned receipt loses body padding or gets clipped at the renderer height.
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-100000px";
  iframe.style.top = "0";
  iframe.style.width = `${width}px`;
  iframe.style.height = "100px";
  iframe.style.border = "0";
  iframe.style.visibility = "visible";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  try {
    const frameDoc = iframe.contentDocument;
    if (!frameDoc) throw new Error("Could not create the bill image document.");

    frameDoc.open();
    frameDoc.write(html || "<!doctype html><html><body></body></html>");
    frameDoc.close();

    await new Promise<void>((resolve) => {
      if (frameDoc.readyState === "complete") resolve();
      else iframe.addEventListener("load", () => resolve(), { once: true });
    });

    const body = frameDoc.body;
    const docEl = frameDoc.documentElement;
    if (!body) throw new Error("Bill HTML has no body to capture.");

    // Force the exact thermal/A4 width and preserve the configured margins.
    body.style.width = `${width}px`;
    body.style.maxWidth = `${width}px`;
    body.style.minHeight = "0";
    body.style.height = "auto";
    body.style.overflow = "visible";
    body.style.boxSizing = "border-box";
    body.style.background = "#fff";
    body.style.color = "#000";
    body.style.margin = body.style.margin || "0";
    body.style.paddingBottom = `calc(${body.style.paddingBottom || "0px"} + 16px)`;

    // Ensure all images and fonts have settled before measuring the complete
    // receipt. The extra bottom safety margin prevents the last dashed line,
    // footer or text descender from touching the PNG boundary.
    const images = Array.from(body.querySelectorAll("img"));
    await Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }));
    try { await frameDoc.fonts?.ready; } catch { /* font loading is optional */ }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // scrollHeight is more reliable than getBoundingClientRect for long
    // receipts because it includes content extending beyond the viewport.
    const contentHeight = Math.max(
      1,
      Math.ceil(body.scrollHeight),
      Math.ceil(body.offsetHeight),
      Math.ceil(docEl?.scrollHeight || 0),
    );

    iframe.style.height = `${contentHeight}px`;

    const capture = async (removeImages = false): Promise<string> => {
      if (removeImages) body.querySelectorAll("img").forEach((img) => img.remove());

      const canvas = await html2canvas(body, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        height: contentHeight,
        windowWidth: width,
        windowHeight: Math.max(contentHeight, 1000),
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
      });

      // Give the generated PNG a guaranteed white bottom safety area. This is
      // deliberately small so it looks like a natural receipt margin.
      const padded = document.createElement("canvas");
      padded.width = canvas.width;
      padded.height = canvas.height + 24;
      const ctx = padded.getContext("2d");
      if (!ctx) return canvas.toDataURL("image/png");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, padded.width, padded.height);
      ctx.drawImage(canvas, 0, 0);
      return padded.toDataURL("image/png");
    };

    try {
      return await capture(false);
    } catch (firstError) {
      // A remote shop logo can taint/fail the canvas. Retry without images so
      // the customer still receives the complete bill rather than a cut-off
      // or missing image.
      try {
        return await capture(true);
      } catch (secondError) {
        const first = String((firstError as any)?.message || firstError || "");
        const second = String((secondError as any)?.message || secondError || "");
        throw new Error(second || first || "Could not render the complete bill image.");
      }
    }
  } finally {
    iframe.remove();
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
