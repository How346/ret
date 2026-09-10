// Local (offline) data store for the desktop build.
//
// Everything the app normally reads from the cloud lives here instead:
// rows are kept in memory and persisted to IndexedDB (which Electron keeps
// inside the Windows user-data folder), so the app works with no internet at all.

export type Row = Record<string, any>;

const DB_NAME = "margin-erp-offline";
const STORE = "kv";
const KEY = "database";

export const TABLES = [
  "categories", "customers", "held_bills", "licenses", "printer_profiles",
  "product_variants", "products", "profiles", "purchase_items", "purchases",
  "sale_items", "sales", "stock_ledger", "store_settings", "stores",
  "suppliers", "user_roles",
] as const;
export type TableName = (typeof TABLES)[number];

type DbShape = {
  tables: Record<string, Row[]>;
  meta: Record<string, any>;
  files: Record<string, string>; // storage path -> data URL
  users: Array<{ id: string; email: string; password: string; full_name: string; created_at: string }>;
};

export const db: DbShape = { tables: {}, meta: {}, files: {}, users: [] };

// ---------- defaults applied on insert ----------
const DEFAULTS: Record<string, Row> = {
  products: {
    barcode: null, category_id: null, gst_rate: 18, hsn_code: null, image_url: null,
    is_active: true, low_stock_alert: 5, mrp: 0, purchase_price: 0, sale_price: 0,
    sku: null, stock: 0, store_id: null, unit: "PCS", wholesale_price: 0,
  },
  product_variants: { label: null, barcode: null, mrp: 0, sale_price: 0, purchase_price: 0, stock: 0 },
  customers: { phone: null, email: null, address: null, gstin: null, balance: 0, store_id: null },
  suppliers: { phone: null, email: null, address: null, gstin: null, balance: 0, store_id: null },
  categories: { store_id: null },
  sales: {
    subtotal: 0, discount: 0, tax_total: 0, total: 0, paid: 0, cash: 0, card: 0, upi: 0,
    payment_mode: "cash", customer_id: null, status: "completed", notes: null, store_id: null,
  },
  sale_items: { discount: 0, gst_rate: 0, hsn_code: null, mrp: 0, tax_amount: 0, total: 0 },
  purchases: { subtotal: 0, tax_total: 0, total: 0, discount: 0, supplier_id: null, supplier_name: null, notes: null, store_id: null },
  purchase_items: { gst_rate: 0, mrp: 0, total: 0, cost: 0, qty: 0 },
  stock_ledger: { note: null, ref_id: null, store_id: null },
  profiles: { full_name: null, is_blocked: false, store_id: null },
  licenses: { status: "active", notes: null, plan: "standard", user_id: null },
  printer_profiles: { is_default: false },
  held_bills: { note: null, store_id: null },
  store_settings: {
    singleton: true, shop_name: "My Shop", address: null, phone: null, email: null, gstin: null,
    state: null, state_code: null, logo_url: null, upi_id: null, bank_name: null,
    bank_account: null, bank_ifsc: null, terms: null, invoice_footer: "Thank you! Visit again",
    invoice_prefix: "INV", bill_no_format: "short", paper_size: "80mm", print_copies: 1,
    auto_print: true, show_logo: true, show_gstin: true, show_footer: true,
    show_gst_breakdown: true, receipt_bold: false, receipt_font_size: 12,
    receipt_line_height: 1.25, receipt_margin_top: 4, receipt_margin_bottom: 6,
    receipt_margin_left: 3, receipt_margin_right: 3,
    whatsapp_enabled: false, whatsapp_country_code: "91",
    whatsapp_message_template: "Hi {customer}, thank you for shopping at {shop}! Your bill {invoice} of {total} is attached. Visit again!",
  },
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function withDefaults(table: string, row: Row): Row {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    created_at: now,
    updated_at: now,
    ...(DEFAULTS[table] ?? {}),
    ...row,
  };
}

export function table(name: string): Row[] {
  if (!db.tables[name]) db.tables[name] = [];
  return db.tables[name];
}

// ---------- IndexedDB persistence ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function load(): Promise<DbShape | null> {
  try {
    const conn = await idb();
    return await new Promise((res, rej) => {
      const r = conn.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      r.onsuccess = () => res((r.result as DbShape) ?? null);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const conn = await idb();
      const snapshot = JSON.parse(JSON.stringify(db));
      conn.transaction(STORE, "readwrite").objectStore(STORE).put(snapshot, KEY);
    } catch (e) {
      console.error("[offline-db] persist failed", e);
    }
  }, 250);
}

export async function hashPassword(pw: string): Promise<string> {
  const bytes = new TextEncoder().encode("margin-erp::" + pw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function seed() {
  for (const t of TABLES) table(t);
  if (table("store_settings").length === 0) {
    table("store_settings").push(withDefaults("store_settings", {}));
  }
  if (db.meta.invoice_seq == null) db.meta.invoice_seq = 0;
}

// Built-in owner account for the desktop build: ID "admin", password "admin".
async function seedAdmin() {
  if (db.users.some((u) => u.email === "admin")) return;
  const id = uuid();
  db.users.push({
    id,
    email: "admin",
    password: await hashPassword("admin"),
    full_name: "Administrator",
    created_at: new Date().toISOString(),
  });
  table("profiles").push(withDefaults("profiles", { id, full_name: "Administrator" }));
  table("user_roles").push(withDefaults("user_roles", { user_id: id, role: "admin" }));
}

let readyPromise: Promise<void> | null = null;
export function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const saved = await load();
      if (saved) {
        db.tables = saved.tables ?? {};
        db.meta = saved.meta ?? {};
        db.files = saved.files ?? {};
        db.users = saved.users ?? [];
      }
      seed();
      await seedAdmin();
      persist();
    })();
  }
  return readyPromise;
}


// ---------- whole-database export / import (for local file backups) ----------
export function exportDatabase(): string {
  return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), db }, null, 2);
}

export function importDatabase(json: string) {
  const parsed = JSON.parse(json);
  const src = parsed.db ?? parsed;
  db.tables = src.tables ?? {};
  db.meta = src.meta ?? {};
  db.files = src.files ?? {};
  db.users = src.users ?? [];
  seed();
  persist();
}
