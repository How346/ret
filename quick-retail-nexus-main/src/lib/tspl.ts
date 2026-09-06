// TSPL / TSPL2 command generator for TSC TTP-244 Pro and compatible thermal
// label printers. Produces raw text commands that can be sent to the printer
// via USB / LPT / TCP or downloaded as a .prn file.

export type Sensor = "GAP" | "BLINE" | "CONTINUOUS";
export type Rotation = 0 | 90 | 180 | 270;

export type PrinterProfileConfig = {
  paperWidthMm: number;   // media / roll width (e.g. 76)
  paperHeightMm: number;  // logical page height (usually = labelHeightMm)
  labelWidthMm: number;   // single label width (e.g. 25)
  labelHeightMm: number;  // single label height (e.g. 38)
  columns: number;        // labels across (e.g. 2)
  hGapMm: number;         // horizontal gap between labels
  vGapMm: number;         // vertical gap between labels (feed direction)
  leftMarginMm: number;   // reference X
  topMarginMm: number;    // reference Y
  density: number;        // 0..15
  speed: number;          // 1..6 ips
  sensor: Sensor;
  rotation: Rotation;
  copies: number;
};

export const DEFAULT_TSC_244_PRO: PrinterProfileConfig = {
  paperWidthMm: 76,
  paperHeightMm: 38,
  labelWidthMm: 25,
  labelHeightMm: 38,
  columns: 2,
  hGapMm: 2,
  vGapMm: 2,
  leftMarginMm: 0,
  topMarginMm: 0,
  density: 10,
  speed: 4,
  sensor: "GAP",
  rotation: 0,
  copies: 1,

};

export type LabelData = {
  productName: string;
  sku?: string;
  price?: number | string;
  batch?: string;
  barcode?: string;   // Code128 text
  qr?: string;        // QR text (URL or data)
};

const mm = (n: number) => Number(n.toFixed(2));

/** Build TSPL header (SIZE, GAP/BLINE, DENSITY, SPEED, DIRECTION, REFERENCE, CLS). */
export function tsplHeader(cfg: PrinterProfileConfig): string {
  const direction = cfg.rotation === 180 ? 0 : 1; // TSPL DIRECTION 0/1
  const sensor =
    cfg.sensor === "BLINE"
      ? `BLINE ${mm(cfg.vGapMm)} mm, 0 mm`
      : cfg.sensor === "CONTINUOUS"
      ? `GAP 0 mm, 0 mm`
      : `GAP ${mm(cfg.vGapMm)} mm, 0 mm`;
  return [
    `SIZE ${mm(cfg.paperWidthMm)} mm, ${mm(cfg.paperHeightMm)} mm`,
    sensor,
    `DENSITY ${Math.max(0, Math.min(15, cfg.density))}`,
    `SPEED ${Math.max(1, Math.min(6, cfg.speed))}`,
    `DIRECTION ${direction}`,
    `REFERENCE ${Math.round(cfg.leftMarginMm * 8)},${Math.round(cfg.topMarginMm * 8)}`, // 203dpi → 8 dots/mm
    `CLS`,
  ].join("\r\n");
}

/** Render one label at (xMm, yMm) origin. Uses 203dpi (8 dots/mm). */
export function tsplRenderLabel(
  data: LabelData,
  cfg: PrinterProfileConfig,
  xMm: number,
  yMm: number,
): string {
  const x = Math.round(xMm * 8);
  const y = Math.round(yMm * 8);
  const w = Math.round(cfg.labelWidthMm * 8);
  const lines: string[] = [];
  let cy = y + 8;
  // Store / product name
  lines.push(`TEXT ${x + 4},${cy},"3",0,1,1,"${esc(data.productName.slice(0, 22))}"`);
  cy += 26;
  if (data.sku) {
    lines.push(`TEXT ${x + 4},${cy},"2",0,1,1,"SKU: ${esc(data.sku)}"`);
    cy += 20;
  }
  if (data.price !== undefined && data.price !== "") {
    lines.push(`TEXT ${x + 4},${cy},"3",0,1,1,"₹${esc(String(data.price))}"`);
    cy += 26;
  }
  if (data.batch) {
    lines.push(`TEXT ${x + 4},${cy},"1",0,1,1,"B/N: ${esc(data.batch)}"`);
    cy += 16;
  }
  if (data.qr) {
    lines.push(`QRCODE ${x + w - 60},${y + 8},H,4,A,0,"${esc(data.qr)}"`);
  }
  if (data.barcode) {
    lines.push(`BARCODE ${x + 4},${cy + 4},"128",50,1,0,2,2,"${esc(data.barcode)}"`);
  }
  return lines.join("\r\n");
}

function esc(s: string) {
  return String(s).replace(/"/g, "'");
}

/** Full print job for N items using column layout (auto centered on media). */
export function tsplPrintJob(items: LabelData[], cfg: PrinterProfileConfig): string {
  if (!items.length) return "";
  const cols = Math.max(1, cfg.columns);
  const totalRowWidth = cols * cfg.labelWidthMm + (cols - 1) * cfg.hGapMm;
  const leftPad = Math.max(0, (cfg.paperWidthMm - totalRowWidth) / 2);
  const out: string[] = [tsplHeader(cfg)];
  // Layout N items across cols; when a row fills we PRINT and CLS for the next row.
  let rowIdx = 0;
  const perRow = cols;
  for (let i = 0; i < items.length; i += perRow) {
    const row = items.slice(i, i + perRow);
    row.forEach((it, ci) => {
      const x = leftPad + ci * (cfg.labelWidthMm + cfg.hGapMm);
      const y = cfg.topMarginMm;
      out.push(tsplRenderLabel(it, cfg, x, y));
    });
    out.push(`PRINT 1,${Math.max(1, cfg.copies)}`);
    if (i + perRow < items.length) out.push(`CLS`);
    rowIdx++;
  }
  return out.join("\r\n") + "\r\n";
}

export function tsplCalibrate(cfg: PrinterProfileConfig): string {
  return [
    `SIZE ${mm(cfg.paperWidthMm)} mm, ${mm(cfg.paperHeightMm)} mm`,
    cfg.sensor === "BLINE" ? `BLINE ${mm(cfg.vGapMm)} mm, 0 mm` : `GAP ${mm(cfg.vGapMm)} mm, 0 mm`,
    `GAPDETECT`,
    `HOME`,
  ].join("\r\n") + "\r\n";
}

export function tsplTestSample(cfg: PrinterProfileConfig): string {
  const sample: LabelData[] = Array.from({ length: cfg.columns }, (_, i) => ({
    productName: "TEST LABEL",
    sku: `SKU-${i + 1}`,
    price: "199.00",
    batch: "B001",
    barcode: "1234567890128",
  }));
  return tsplPrintJob(sample, cfg);
}

/** Trigger a browser download of the raw TSPL job as a .prn file. */
export function downloadTsplFile(name: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".prn") ? name : `${name}.prn`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   Fixed 2-up label template for TSC TTP-244 Pro
   Media: 76 mm x 25 mm roll with 2 labels across.
   Uses the exact TSPL layout provided by the user.
   ============================================================ */

export type FixedLabel = {
  shop: string;          // e.g. "MART"
  name: string;          // product name
  code: string;          // barcode / SKU text
  mrp?: number | string;
  price?: number | string;
};

function tsplEscape(s: string): string {
  return String(s ?? "").replace(/"/g, "'").slice(0, 40);
}

/** Build a single 2-up print pass matching user's TSPL template. */
export function buildFixedLabelPair(left: FixedLabel, right?: FixedLabel | null): string {
  const r = right ?? left;
  const line = (l: FixedLabel, x: number) => [
    `TEXT ${x},175,"0",180,12,12,"${tsplEscape(l.shop || "MART").toUpperCase()}"`,
    `TEXT ${x},135,"0",180,10,10,"${tsplEscape(l.name)}"`,
    `BARCODE ${x},70,"128M",38,0,180,2,4,"${tsplEscape(l.code)}"`,
    `TEXT ${x},30,"0",180,10,10,"${tsplEscape(l.code)}"`,
    `TEXT ${x},100,"0",180,10,10,"MRP:${l.mrp ?? ""} PRICE:${l.price ?? ""}"`,
  ].join("\r\n");
  return [
    "CLS",
    "SIZE 76 mm, 25 mm",
    "GAP 2 mm, 0 mm",
    "SPEED 2",
    "DENSITY 5",
    "DIRECTION 0,0",
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    "SHIFT 0",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "SET TEAR ON",
    "CLS",
    "CODEPAGE 850",
    "; ================= LEFT LABEL =================",
    line(left, 290),
    "; ================= RIGHT LABEL =================",
    line(r, 594),
    "PRINT 1,1",
  ].join("\r\n") + "\r\n";
}

/** Build the whole job: pairs of labels, one PRINT per pair. */
export function buildFixedLabelJob(items: FixedLabel[]): string {
  if (!items.length) return "";
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(buildFixedLabelPair(items[i], items[i + 1] ?? null));
  }
  return out.join("");
}

/* ---------- WebUSB direct print ---------- */

const USB_KEY = "tsc_usb_device_v1";

async function pickPrinter(): Promise<any> {
  const usb: any = (navigator as any).usb;
  if (!usb) throw new Error("WebUSB is not available in this browser. Use Chrome/Edge over HTTPS.");
  // TSC vendor id is 0x1203; also allow generic printer class (7).
  const device = await usb.requestDevice({
    filters: [
      { vendorId: 0x1203 },              // TSC
      { classCode: 7 },                  // USB Printer class
    ],
  });
  try { localStorage.setItem(USB_KEY, `${device.vendorId}:${device.productId}`); } catch {}
  return device;
}

async function getPairedPrinter(): Promise<any | null> {
  const usb: any = (navigator as any).usb;
  if (!usb?.getDevices) return null;
  const saved = localStorage.getItem(USB_KEY);
  const list = await usb.getDevices();
  if (!list?.length) return null;
  if (saved) {
    const [vid, pid] = saved.split(":").map(Number);
    return list.find((d: any) => d.vendorId === vid && d.productId === pid) ?? list[0];
  }
  return list[0];
}

/** Send raw TSPL over WebUSB. Falls back to .prn download if unsupported. */
export async function printTsplDirect(tspl: string, jobName = "labels"): Promise<"usb" | "download"> {
  const usb: any = (navigator as any).usb;
  if (!usb) {
    downloadTsplFile(jobName, tspl);
    return "download";
  }
  let device = await getPairedPrinter();
  if (!device) device = await pickPrinter();
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  // Find printer interface + OUT endpoint
  const cfg = device.configuration;
  let ifaceNum = 0;
  let outEp = 1;
  outer: for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 7 || alt.interfaceClass === 0xff) {
        ifaceNum = iface.interfaceNumber;
        const ep = alt.endpoints.find((e: any) => e.direction === "out");
        if (ep) { outEp = ep.endpointNumber; break outer; }
      }
    }
  }
  try { await device.claimInterface(ifaceNum); } catch { /* already claimed */ }
  const bytes = new TextEncoder().encode(tspl);
  // Split into 64KB chunks to be safe
  const CHUNK = 64 * 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await device.transferOut(outEp, bytes.slice(i, i + CHUNK));
  }
  try { await device.releaseInterface(ifaceNum); } catch {}
  try { await device.close(); } catch {}
  return "usb";
}

