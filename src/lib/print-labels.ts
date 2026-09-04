// Barcode label printing for TSC TTP-244 Pro (203 DPI) and 300 DPI thermal
// printers. Renders a rigid grid of fixed-size labels (default 40mm x 25mm)
// that never resize based on content — long text shrinks in font size, it
// does NOT grow the label.

import JsBarcode from "jsbarcode";

export type LabelItem = {
  name: string;
  price: number;
  barcode: string;
  sku?: string | null;
  mrp?: number | null;
  shop?: string | null;
  weight?: string | null; // e.g. "100G", "1KG", "250ML"
};

export type LabelSize = {
  widthMm: number;
  heightMm: number;
  gapMm?: number;
  columns?: number;
  rowsPerPage?: number;    // physical rows per printer page/sheet (default 1 for continuous roll)
  fillFromBottom?: boolean; // pad empty cells at the top so first item prints at bottom-left
};

const DEFAULT_SIZE: LabelSize = { widthMm: 40, heightMm: 25, gapMm: 2, columns: 1, rowsPerPage: 1, fillFromBottom: true };


function renderBarcodeSvg(value: string): string {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  try {
    JsBarcode(svg, value || "0000000000", {
      format: "CODE128",
      width: 1.6,
      height: 40,
      displayValue: false,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch {
    // ignore
  }
  svg.setAttribute("preserveAspectRatio", "none");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return svg.outerHTML;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

export function printLabels(items: LabelItem[], size: LabelSize = DEFAULT_SIZE) {
  const widthMm = size.widthMm || 40;
  const heightMm = size.heightMm || 25;
  const gapMm = size.gapMm ?? 2;
  const columns = Math.max(1, size.columns ?? 1);
  const rowsPerPage = Math.max(1, size.rowsPerPage ?? 1);
  const fillFromBottom = size.fillFromBottom !== false;
  if (!items.length) return;

  const money = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

  const renderCell = (it: LabelItem | null) => {
    if (!it) return `<div class="lbl empty"></div>`;
    const bc = it.barcode || it.sku || "";
    const barcodeSvg = renderBarcodeSvg(bc);
    return `<div class="lbl">
      ${it.shop ? `<div class="shop">${esc(it.shop.toUpperCase())}</div>` : ""}
      <div class="name">${esc(it.name)}</div>
      ${it.weight ? `<div class="weight">${esc(it.weight.toUpperCase())}</div>` : ""}
      ${it.mrp ? `<div class="mrp">MRP: ₹${money(it.mrp)}</div>` : ""}
      <div class="price">PRICE: ₹${money(it.price)}</div>
      <div class="bc">${barcodeSvg}</div>
      <div class="bcnum">${esc(bc)}</div>
    </div>`;
  };

  // Split items into pages, fill each page from the BOTTOM so partial pages
  // leave the TOP labels blank (preserves peel-off labels for reuse) and prints
  // "start from bottom" as requested.
  const perPage = columns * rowsPerPage;
  const pages: (LabelItem | null)[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    const chunk = items.slice(i, i + perPage);
    if (fillFromBottom && chunk.length < perPage) {
      const pad = Array<LabelItem | null>(perPage - chunk.length).fill(null);
      pages.push([...pad, ...chunk]);
    } else {
      pages.push(chunk);
    }
  }
  const cells = pages
    .map((page) => page.map(renderCell).join(""))
    .join("");

  const pageWidth = columns * widthMm + (columns - 1) * gapMm;


  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Barcode Labels</title>
    <style>
      @page { size: auto; margin: 0; }
      @media print {
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0; padding: 0; background: #fff; color: #000;
        font-family: Arial, Helvetica, sans-serif;
        -webkit-font-smoothing: none;
        font-variant-numeric: tabular-nums;
      }
      .sheet {
        display: grid;
        grid-template-columns: repeat(${columns}, ${widthMm}mm);
        gap: ${gapMm}mm ${gapMm}mm;
        width: ${pageWidth}mm;
      }
      .lbl {
        width: ${widthMm}mm;
        height: ${heightMm}mm;
        padding: 2mm;
        overflow: hidden;
        page-break-inside: avoid;
        break-inside: avoid;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        color: #000;
        background: #fff;
        line-height: 1.1;
      }
      .shop {
        font-size: 7pt;
        font-weight: 900;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.3pt;
        margin-bottom: 0.3mm;
      }
      .name {
        font-size: 6.5pt;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .weight {
        font-size: 6pt;
        font-weight: 700;
        text-align: center;
      }
      .mrp {
        font-size: 5.5pt;
        font-weight: 600;
        text-align: center;
      }
      .price {
        font-size: 6.5pt;
        font-weight: 900;
        text-align: center;
        margin-bottom: 0.3mm;
      }
      .bc {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .bc svg {
        display: block;
        width: ${widthMm - 4}mm;
        height: 100%;
        max-height: 11mm;
        shape-rendering: crispEdges;
      }
      .bcnum {
        font-size: 5.5pt;
        font-family: 'Courier New', monospace;
        text-align: center;
        letter-spacing: 0.4pt;
        margin-top: 0.2mm;
      }
    </style></head>
    <body><div class="sheet">${cells}</div>
    <script>setTimeout(()=>{try{window.print()}catch(_){} }, 300);</script>
    </body></html>`;

  const w = window.open("", "_blank", "width=520,height=640");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
}
