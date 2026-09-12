// Thermal receipt printer styled to match the classic Indian retail "GST INVOICE"
// layout (DMD-MART style): centered header, columnar item table with
// S | Description | Qty | MRP | RATE | Amt, Bnf savings + MRP total summary,
// Item Qty + Round off + G.TOTAL block, amount-in-words and footer.

import { dispatchPrintHtml } from "@/lib/print-dispatch";

export type PrintSettings = {
  shop_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  state?: string | null;
  state_code?: string | null;
  logo_url?: string | null;
  invoice_footer?: string | null;
  terms?: string | null;
  paper_size: "58mm" | "80mm" | "A4";
  print_copies: number;
  show_logo: boolean;
  show_gstin: boolean;
  show_footer: boolean;
  auto_print: boolean;
  upi_id?: string | null;
  receipt_font_size?: number;       // override base font size (px)
  show_gst_breakdown?: boolean;     // show CGST/SGST/IGST split; if false bill says inclusive only
  bill_no_format?: "short" | "full";
  receipt_margin_top?: number;      // mm
  receipt_margin_bottom?: number;   // mm
  receipt_margin_left?: number;     // mm
  receipt_margin_right?: number;    // mm
  receipt_bold?: boolean;           // print all text in bold for high contrast
  receipt_line_height?: number;     // css line-height multiplier
};

export type ReceiptItem = {
  name: string;
  hsn_code?: string | null;
  qty: number;
  price: number;       // Selling rate (after discount)
  mrp?: number;        // Optional MRP; defaults to price
  discount: number;
  gst_rate: number;
};

export type ReceiptTotals = {
  subtotal: number;
  cgst: number;
  sgst: number;
  igst?: number;
  discount?: number;
  total: number;
};

export type ReceiptPayment = { cash: number; card: number; upi: number };

const DEFAULTS: PrintSettings = {
  shop_name: "BUSINESS NAME",
  paper_size: "80mm",
  print_copies: 1,
  show_logo: true,
  show_gstin: true,
  show_footer: true,
  auto_print: true,
};

export function printReceipt(opts: {
  invoiceNo: string;
  date?: Date;
  customer?: { name?: string; phone?: string | null; gstin?: string | null } | null;
  cart: ReceiptItem[];
  totals: ReceiptTotals;
  payment: ReceiptPayment;
  settings?: Partial<PrintSettings> | null;
  cashierName?: string | null;
}) {
  const html = buildReceiptHtml(opts);
  const s: PrintSettings = { ...DEFAULTS, ...(opts.settings ?? {}) } as PrintSettings;
  dispatchPrintHtml(html, { kind: "receipt", windowWidth: s.paper_size === "A4" ? 800 : 380, windowHeight: 720 });
}

// Builds the receipt HTML document without printing it — used by printReceipt()
// above and by the WhatsApp bill-sharing flow, which needs the same markup
// rendered to an image instead of sent to a printer.
export function buildReceiptHtml(opts: {
  invoiceNo: string;
  date?: Date;
  customer?: { name?: string; phone?: string | null; gstin?: string | null } | null;
  cart: ReceiptItem[];
  totals: ReceiptTotals;
  payment: ReceiptPayment;
  settings?: Partial<PrintSettings> | null;
  cashierName?: string | null;
}): string {
  const s: PrintSettings = { ...DEFAULTS, ...(opts.settings ?? {}) } as PrintSettings;
  const widthMm = s.paper_size === "58mm" ? 58 : s.paper_size === "80mm" ? 80 : 210;
  const defaultFont = s.paper_size === "58mm" ? 12 : s.paper_size === "80mm" ? 13 : 13;
  const fontSize = Math.max(8, Math.min(20, Number(s.receipt_font_size) || defaultFont));
  const mTop = Number.isFinite(Number(s.receipt_margin_top)) ? Number(s.receipt_margin_top) : (s.paper_size === "A4" ? 12 : 2);
  const mBot = Number.isFinite(Number(s.receipt_margin_bottom)) ? Number(s.receipt_margin_bottom) : (s.paper_size === "A4" ? 12 : 2);
  const mLeft = Number.isFinite(Number(s.receipt_margin_left)) ? Number(s.receipt_margin_left) : (s.paper_size === "A4" ? 12 : 3);
  const mRight = Number.isFinite(Number(s.receipt_margin_right)) ? Number(s.receipt_margin_right) : (s.paper_size === "A4" ? 12 : 3);
  const lineH = Math.max(1, Math.min(2, Number(s.receipt_line_height) || 1.3));
  const bold = s.receipt_bold !== false;
  const showGstBreak = s.show_gst_breakdown !== false; // default true

  const date = opts.date ?? new Date();
  const money = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const dateStr = `${dd}-${mm}-${yyyy}`;
  const timeStr = `${hh}:${mi}`;

  // ---- Totals derived for the summary block ----
  const itemQty = opts.cart.reduce((s, it) => s + (it.qty || 0), 0);
  const mrpTotal = opts.cart.reduce((s, it) => s + (it.mrp ?? it.price) * it.qty, 0);
  const lineTotal = opts.cart.reduce((s, it) => s + it.price * it.qty - (it.discount || 0), 0);
  const savings = Math.max(0, mrpTotal - lineTotal);
  const rounded = Math.round(opts.totals.total);
  const roundOff = +(rounded - opts.totals.total).toFixed(2);

  const customer = opts.customer?.name || "CASH";
  const mobile = opts.customer?.phone || "";
  const cgstin = opts.customer?.gstin || "";

  const rows = opts.cart
    .map((it, i) => {
      const amt = it.price * it.qty - (it.discount || 0);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td class="desc">${escapeHtml(it.name)}</td>
        <td class="r">${it.qty}</td>
        <td class="r">${money(it.mrp ?? it.price)}</td>
        <td class="r">${money(it.price)}</td>
        <td class="r">${money(amt)}</td>
      </tr>`;
    })
    .join("");

  const words = numToIndianWords(rounded);

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <title>${escapeHtml(opts.invoiceNo)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; background:#fff; color:#000; }
    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      font-size: ${fontSize}px;
      width: ${widthMm}mm;
      padding: ${mTop}mm ${mRight}mm ${mBot}mm ${mLeft}mm;
      line-height: ${lineH};
      font-weight: ${bold ? 600 : 400};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    .center { text-align:center; }
    .small { font-size:${fontSize - 1}px; }
    .tiny { font-size:${fontSize - 2}px; }
    .title { font-size:${fontSize - 1}px; letter-spacing:1px; }
    .shop {
      font-family: Arial, Helvetica, sans-serif;
      font-weight: ${bold ? 900 : 600};
      font-size: ${fontSize + 10}px;
      letter-spacing: 1px;
      line-height: 1.05;
      margin: 1px 0 2px;
    }
    .hr {
      height: 1px; margin: 4px 0; border: 0;
      background: repeating-linear-gradient(to right, #000 0, #000 3px, transparent 3px, transparent 6px);
    }
    .hr2 { height: 1.5px; margin: 4px 0; border: 0; background: #000; }
    .row { display:flex; justify-content:space-between; gap:8px; }
    table { width:100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    th, td { padding: 2px 2px; vertical-align: top; }
    th { font-weight: ${bold ? 800 : 500}; border-bottom: 1px solid #000; }
    .c { text-align:center; }
    .r { text-align:right; font-variant-numeric: tabular-nums; }
    .desc { word-break: break-word; }
    th.s, td.c:first-child { width: 7%; }
    th.q, td.r.q { width: 9%; }
    th.m, th.rt, th.a { width: 16%; }
    .sumLeft { font-weight: ${bold ? 800 : 500}; }
    .gtotal { font-weight: ${bold ? 900 : 600}; font-size:${fontSize + 2}px; }
    .copy { page-break-after: always; }
    .copy:last-child { page-break-after: auto; }
    .logo { text-align:center; margin-bottom:2px; }
    .logo img { max-height:42px; max-width:70%; filter: grayscale(1) contrast(1.4); }
  </style></head><body>
  ${Array.from({ length: Math.max(1, s.print_copies) }).map((_, copyIdx) => `
  <div class="copy">
    ${s.show_logo && s.logo_url ? `<div class="logo"><img src="${escapeHtml(s.logo_url)}" alt=""/></div>` : ""}
    <div class="center title">GST INVOICE</div>
    <div class="center shop">${escapeHtml(s.shop_name.toUpperCase())}</div>
    ${s.address ? `<div class="center small">${escapeHtml(s.address)}</div>` : ""}
    ${s.phone ? `<div class="center small">Phone : ${escapeHtml(s.phone)}</div>` : ""}
    ${s.email ? `<div class="center small">E-Mail : ${escapeHtml(s.email)}</div>` : ""}
    ${s.show_gstin && s.gstin ? `<div class="center small">GSTIN : ${escapeHtml(s.gstin)}</div>` : ""}

    <div class="hr"></div>
    <div class="row"><span>Customer: ${escapeHtml(customer)}</span><span>Bill No. ${escapeHtml(opts.invoiceNo)}</span></div>
    <div class="row"><span>Mobile : ${escapeHtml(mobile)}</span><span>Date :  ${dateStr}</span></div>
    <div class="row"><span>GSTIN : ${escapeHtml(cgstin)}</span><span>Time :  ${timeStr}</span></div>

    <div class="hr"></div>
    <table>
      <thead>
        <tr>
          <th class="s c">S.</th>
          <th>Description</th>
          <th class="q r">Qty</th>
          <th class="m r">MRP</th>
          <th class="rt r">RATE</th>
          <th class="a r">Amt</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hr"></div>

    <div class="row">
      <span class="sumLeft">Bnf. Amount: ${money(savings)}</span>
      <span class="sumLeft">MRP TOTAL : ${money(mrpTotal)}</span>
    </div>
    <div class="center small">${showGstBreak ? "" : "ALL ITEMS RATES GST INCLUSIVE"}</div>
    <div class="row">
      <span>Item Qty :  ${itemQty}</span>
      <span>Round off: ${money(roundOff)}</span>
    </div>
    <div class="row">
      <span></span>
      <span class="gtotal">G.TOTAL : ${money(rounded)}</span>
    </div>
    <div class="hr"></div>

    <div class="small">Rs. ${escapeHtml(words)} only</div>
    <div class="row" style="margin-top:2px">
      <span class="sumLeft">TOTAL BILL AMOUNT:</span>
      <span class="sumLeft">${money(rounded)}</span>
    </div>
    <div class="row small" style="margin-top:2px">
      <span>E.&amp;O.E</span>
      <span>For ${escapeHtml(s.shop_name.toUpperCase())}</span>
    </div>

    ${(showGstBreak && (opts.totals.cgst || opts.totals.sgst || opts.totals.igst)) ? `
    <div class="hr"></div>
    <div class="row tiny"><span>Taxable</span><span>${money(opts.totals.subtotal)}</span></div>
    ${opts.totals.cgst ? `<div class="row tiny"><span>CGST</span><span>${money(opts.totals.cgst)}</span></div>` : ""}
    ${opts.totals.sgst ? `<div class="row tiny"><span>SGST</span><span>${money(opts.totals.sgst)}</span></div>` : ""}
    ${opts.totals.igst ? `<div class="row tiny"><span>IGST</span><span>${money(opts.totals.igst)}</span></div>` : ""}
    ` : ""}

    ${(opts.payment.cash || opts.payment.card || opts.payment.upi) ? `
    <div class="hr"></div>
    ${opts.payment.cash ? `<div class="row tiny"><span>Cash</span><span>${money(opts.payment.cash)}</span></div>` : ""}
    ${opts.payment.card ? `<div class="row tiny"><span>Card</span><span>${money(opts.payment.card)}</span></div>` : ""}
    ${opts.payment.upi ? `<div class="row tiny"><span>UPI</span><span>${money(opts.payment.upi)}</span></div>` : ""}
    ` : ""}

    ${s.upi_id ? `<div class="center small" style="margin-top:4px">UPI: ${escapeHtml(s.upi_id)}</div>` : ""}
    ${opts.cashierName ? `<div class="center tiny">Cashier: ${escapeHtml(opts.cashierName)}</div>` : ""}

    <div class="hr"></div>
    <div class="center" style="font-weight:${bold ? 900 : 600};margin-top:4px">!!! Thanks !!! Visit Again !!!</div>
    ${s.show_footer && s.invoice_footer ? `<div class="center small">${escapeHtml(s.invoice_footer)}</div>` : ""}
    ${s.show_footer && s.terms ? `<div class="center tiny">${escapeHtml(s.terms)}</div>` : ""}
    ${s.print_copies > 1 ? `<div class="center tiny">Copy ${copyIdx + 1} of ${s.print_copies}</div>` : ""}
  </div>`).join("")}
  </body></html>`;

  return html;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

// Indian numbering system → words (handles up to crores)
function numToIndianWords(n: number): string {
  n = Math.round(n);
  if (n === 0) return "Zero";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string =>
    x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : "");
  const three = (x: number): string =>
    (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " and " + two(x % 100) : "") : two(x));
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (rest) parts.push(three(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
