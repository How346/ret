// TSPL / TSPL2 command generator for TSC TTP-244 Pro and compatible thermal
// label printers. Desktop builds send the raw job to the Windows printer
// selected in Settings; web builds can still download a .prn file.

export type Sensor = "GAP" | "BLINE" | "CONTINUOUS";
export type Rotation = 0 | 90 | 180 | 270;

import { getPrinterPrefs } from "@/lib/printer-prefs";

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
  // TSC TTP-244 Pro at 203 DPI: 8 dots/mm.
  // Two 25 mm labels + 2 mm gap fit safely inside a 76 mm media width.
  const leftX = 96;
  const rightX = 312;
  const label = (l: FixedLabel, x: number) => {
    const name = tsplEscape(l.name || "PRODUCT").slice(0, 22);
    const shop = tsplEscape(l.shop || "MART").toUpperCase().slice(0, 18);
    const code = tsplEscape(l.code || "").slice(0, 20);
    const mrp = l.mrp == null ? "" : String(l.mrp);
    const price = l.price == null ? "" : String(l.price);

    return [
      `TEXT ${x + 4},12,"2",0,1,1,"${name}"`,
      `TEXT ${x + 4},38,"1",0,1,1,"${shop}"`,
      `TEXT ${x + 4},62,"1",0,1,1,"MRP:${tsplEscape(mrp)} PRICE:${tsplEscape(price)}"`,
      // 128M is supported by TSC TSPL and keeps the barcode compact enough
      // for a 25 mm wide label. HRI is enabled so the code is also readable.
      `BARCODE ${x + 4},88,"128M",100,1,0,2,2,"${code}"`,
    ].join("\r\n");
  };

  const lines = [
    "SIZE 76 mm, 38 mm",
    "GAP 2 mm, 0 mm",
    "SPEED 3",
    "DENSITY 8",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "SET TEAR ON",
    "CODEPAGE 850",
    "CLS",
    label(left, leftX),
  ];

  if (right) lines.push(label(right, rightX));
  lines.push("PRINT 1,1");
  return lines.join("\r\n") + "\r\n";
}

/** Build the whole job: pairs of labels, one PRINT per physical row. */
export function buildFixedLabelJob(items: FixedLabel[]): string {
  if (!items.length) return "";
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(buildFixedLabelPair(items[i], items[i + 1] ?? null));
  }
  return out.join("");
}

/* ---------- Native Windows RAW .PRN printing ---------- */

/**
 * Send a TSPL/.PRN job to the label printer selected in Settings.
 * Electron uses the Windows print spooler in RAW mode, so the printer
 * receives the TSPL commands unchanged. No device pairing is required.
 */
export async function printTsplDirect(tspl: string, jobName = "labels"): Promise<"printer" | "download"> {
  const api = (window as any).electronAPI;
  if (api?.printRaw) {
    const labelPrinter = String(getPrinterPrefs().labelPrinter || "").trim();
    if (!labelPrinter) {
      throw new Error("No label printer selected. Go to Settings → Barcode label printer and select your printer.");
    }
    const result = await api.printRaw(tspl, { kind: "label", deviceName: labelPrinter, jobName });
    if (!result?.success) {
      throw new Error(result?.errorType || "Label printing failed. Select a label printer in Settings.");
    }
    return "printer";
  }

  // Browser/web fallback: there is no safe way for a browser to access the
  // Windows spooler directly, so retain a simple .prn download outside the
  // desktop app. The offline Electron build always uses the selected printer.
  downloadTsplFile(jobName, tspl);
  return "download";
}
