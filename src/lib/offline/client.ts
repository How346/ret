// Drop-in offline replacement for the cloud client.
//
// The desktop (Electron) build aliases "@/integrations/supabase/client" to this
// module, so every existing `supabase.from(...)` / `.auth` / `.rpc` call in the
// app keeps working — but reads and writes hit the local database instead of
// the internet. Nothing here makes a network request.

import { db, persist, ready, table, uuid, withDefaults, exportDatabase, importDatabase } from "./store";

export { exportDatabase, importDatabase };

type Row = Record<string, any>;
type Filter = { op: string; col: string; val: any };

const err = (message: string) => ({ message, details: "", hint: "", code: "offline" });

// --- select() parsing: supports "*", column lists and one level of embeds ---
type Embed = { alias: string; table: string; cols: string };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(sel: string) {
  const cols: string[] = [];
  const embeds: Embed[] = [];
  for (const part of splitTop(sel || "*")) {
    const m = part.match(/^(?:([\w]+):)?([\w]+)(?:!\w+)?\(([^)]*)\)$/);
    if (m) embeds.push({ alias: m[1] ?? m[2], table: m[2], cols: m[3] });
    else cols.push(part.replace(/^[\w]+:/, ""));
  }
  return { cols, embeds };
}

function singular(t: string) {
  return t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("s") ? t.slice(0, -1) : t;
}

function pick(row: Row, cols: string[]): Row {
  if (!cols.length || cols.includes("*")) return { ...row };
  const out: Row = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

function shape(tableName: string, rows: Row[], sel: string): Row[] {
  const { cols, embeds } = parseSelect(sel);
  return rows.map((r) => {
    const out = pick(r, cols);
    for (const e of embeds) {
      const fk = `${singular(e.table)}_id`;
      const target = table(e.table).find((x) => x.id === r[fk]);
      out[e.alias] = target ? pick(target, parseSelect(e.cols).cols) : null;
    }
    return out;
  });
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq": return String(v) === String(f.val);
    case "neq": return String(v) !== String(f.val);
    case "gt": return v > f.val;
    case "gte": return v >= f.val;
    case "lt": return v < f.val;
    case "lte": return v <= f.val;
    case "is": return f.val === null ? v == null : v === f.val;
    case "in": return (f.val as any[]).some((x) => String(x) === String(v));
    case "like":
    case "ilike": {
      const re = new RegExp("^" + String(f.val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
      return re.test(String(v ?? ""));
    }
    default: return true;
  }
}

class QueryBuilder<T = any> implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: Filter[] = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private rangeAt: [number, number] | null = null;
  private sel = "*";
  private wantsRows = false;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any = null;
  private onConflict = "id";
  private singleMode: "none" | "single" | "maybe" = "none";
  private wantCount = false;

  constructor(private tableName: string) {}

  select(sel = "*", opts?: { count?: string; head?: boolean }) {
    this.sel = sel || "*";
    this.wantsRows = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(rows: any) { this.mode = "insert"; this.payload = rows; return this; }
  update(patch: any) { this.mode = "update"; this.payload = patch; return this; }
  upsert(rows: any, opts?: { onConflict?: string }) {
    this.mode = "upsert"; this.payload = rows; this.onConflict = opts?.onConflict ?? "id"; return this;
  }
  delete() { this.mode = "delete"; return this; }

  eq(col: string, val: any) { this.filters.push({ op: "eq", col, val }); return this; }
  neq(col: string, val: any) { this.filters.push({ op: "neq", col, val }); return this; }
  gt(col: string, val: any) { this.filters.push({ op: "gt", col, val }); return this; }
  gte(col: string, val: any) { this.filters.push({ op: "gte", col, val }); return this; }
  lt(col: string, val: any) { this.filters.push({ op: "lt", col, val }); return this; }
  lte(col: string, val: any) { this.filters.push({ op: "lte", col, val }); return this; }
  is(col: string, val: any) { this.filters.push({ op: "is", col, val }); return this; }
  in(col: string, val: any[]) { this.filters.push({ op: "in", col, val }); return this; }
  like(col: string, val: string) { this.filters.push({ op: "like", col, val }); return this; }
  ilike(col: string, val: string) { this.filters.push({ op: "ilike", col, val }); return this; }
  filter(col: string, op: string, val: any) { this.filters.push({ op, col, val }); return this; }
  not() { return this; }
  or(expr: string) {
    // supports "col.ilike.%x%,col2.eq.y"
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      return { op, col, val: rest.join(".") } as Filter;
    });
    this.filters.push({ op: "__or", col: "", val: parts });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(a: number, b: number) { this.rangeAt = [a, b]; return this; }
  single() { this.singleMode = "single"; this.wantsRows = true; return this; }
  maybeSingle() { this.singleMode = "maybe"; this.wantsRows = true; return this; }

  private applyFilters(rows: Row[]) {
    return rows.filter((r) =>
      this.filters.every((f) =>
        f.op === "__or" ? (f.val as Filter[]).some((sub) => matches(r, sub)) : matches(r, f),
      ),
    );
  }

  private sortAndSlice(rows: Row[]) {
    let out = [...rows];
    for (const o of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const av = a[o.col], bv = b[o.col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : -1) * (o.asc ? 1 : -1);
      });
    }
    if (this.rangeAt) out = out.slice(this.rangeAt[0], this.rangeAt[1] + 1);
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  private async run() {
    await ready();
    const rows = table(this.tableName);
    let result: Row[] = [];

    try {
      if (this.mode === "select") {
        result = this.sortAndSlice(this.applyFilters(rows));
      } else if (this.mode === "insert" || this.mode === "upsert") {
        const incoming: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const raw of incoming) {
          if (this.mode === "upsert") {
            const idx = rows.findIndex((r) => String(r[this.onConflict]) === String(raw[this.onConflict]));
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...raw, updated_at: new Date().toISOString() };
              result.push(rows[idx]);
              continue;
            }
          }
          const row = withDefaults(this.tableName, raw);
          rows.push(row);
          result.push(row);
        }
        persist();
      } else if (this.mode === "update") {
        const hits = this.applyFilters(rows);
        for (const h of hits) {
          Object.assign(h, this.payload, { updated_at: new Date().toISOString() });
          result.push(h);
        }
        persist();
      } else if (this.mode === "delete") {
        const hits = this.applyFilters(rows);
        db.tables[this.tableName] = rows.filter((r) => !hits.includes(r));
        result = hits;
        persist();
      }
    } catch (e: any) {
      return { data: null, error: err(e?.message ?? String(e)) };
    }

    const count = result.length;
    if (!this.wantsRows && this.mode !== "select") return { data: null, error: null, count };

    const shaped = shape(this.tableName, result, this.sel);
    if (this.singleMode === "single") {
      if (shaped.length !== 1) {
        return { data: null, error: err(shaped.length ? "multiple rows returned" : "no rows returned"), count };
      }
      return { data: shaped[0], error: null, count };
    }
    if (this.singleMode === "maybe") return { data: shaped[0] ?? null, error: null, count };
    return { data: shaped, error: null, count };
  }

  then<A = any, B = never>(
    onfulfilled?: ((v: { data: any; error: any; count?: number }) => A | PromiseLike<A>) | null,
    onrejected?: ((r: any) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled as any, onrejected as any);
  }
}

// ---------------- local auth ----------------
type SessionUser = { id: string; email: string; user_metadata: Record<string, any>; app_metadata: Record<string, any>; aud: string; created_at: string };
type LocalSession = { user: SessionUser; access_token: string; refresh_token: string; expires_at: number } | null;

const SESSION_KEY = "margin-erp-offline-session";
const listeners = new Set<(event: string, session: LocalSession) => void>();
let session: LocalSession = null;

function readStoredSession(): LocalSession {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(s: LocalSession) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
  listeners.forEach((cb) => cb(s ? "SIGNED_IN" : "SIGNED_OUT", s));
}

async function hash(pw: string): Promise<string> {
  const bytes = new TextEncoder().encode("margin-erp::" + pw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toSession(u: { id: string; email: string; full_name: string; created_at: string }): LocalSession {
  return {
    user: {
      id: u.id, email: u.email, created_at: u.created_at, aud: "local",
      user_metadata: { full_name: u.full_name }, app_metadata: { provider: "local" },
    },
    access_token: "offline", refresh_token: "offline",
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  };
}

const auth = {
  async getSession() {
    await ready();
    if (!session) session = readStoredSession();
    // Never restore a stale/corrupt session for a deleted local account.
    if (session && !db.users.some((u) => u.id === session!.user.id && u.email === session!.user.email)) {
      session = null;
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }
    return { data: { session }, error: null };
  },
  async getUser() {
    const { data } = await this.getSession();
    return { data: { user: data.session?.user ?? null }, error: null };
  },
  onAuthStateChange(cb: (event: string, session: LocalSession) => void) {
    listeners.add(cb);
    ready().then(() => {
      if (!session) session = readStoredSession();
      cb(session ? "INITIAL_SESSION" : "SIGNED_OUT", session);
    });
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    await ready();
    const e = email.trim().toLowerCase();
    const user = db.users.find((u) => u.email === e);
    if (!user || user.password !== (await hash(password))) {
      return { data: { session: null, user: null }, error: err("Invalid email or password") };
    }
    const profile = table("profiles").find((p) => p.id === user.id);
    if (profile?.is_blocked) return { data: { session: null, user: null }, error: err("This account has been blocked by the admin") };
    const s = toSession(user);
    writeSession(s);
    return { data: { session: s, user: s!.user }, error: null };
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, any> } }) {
    await ready();
    const e = email.trim().toLowerCase();
    if (db.users.some((u) => u.email === e)) return { data: { session: null, user: null }, error: err("An account with this email already exists") };
    const user = {
      id: uuid(), email: e, password: await hash(password),
      full_name: options?.data?.full_name ?? e.split("@")[0], created_at: new Date().toISOString(),
    };
    db.users.push(user);
    const first = db.users.length === 1;
    table("profiles").push(withDefaults("profiles", { id: user.id, full_name: user.full_name }));
    table("user_roles").push(withDefaults("user_roles", { user_id: user.id, role: first ? "admin" : "cashier" }));
    persist();
    const s = toSession(user);
    writeSession(s);
    return { data: { session: s, user: s!.user }, error: null };
  },
  async signOut() { writeSession(null); return { error: null }; },
  async updateUser() { return { data: { user: session?.user ?? null }, error: null }; },
  async getClaims() { return { data: null, error: err("not supported offline") }; },
};

// ---------------- rpc / storage / functions ----------------
async function rpc(name: string) {
  await ready();
  if (name === "next_invoice_no" || name === "next_invoice_no_short") {
    db.meta.invoice_seq = (db.meta.invoice_seq ?? 0) + 1;
    persist();
    const n = db.meta.invoice_seq as number;
    if (name === "next_invoice_no_short") return { data: String(n), error: null };
    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { data: `INV-${ym}-${String(n).padStart(4, "0")}`, error: null };
  }
  if (name === "current_store_id") return { data: null, error: null };
  if (name === "has_role") return { data: true, error: null };
  return { data: null, error: err(`rpc ${name} is not available offline`) };
}

const storage = {
  from(_bucket: string) {
    return {
      async upload(path: string, file: Blob) {
        await ready();
        const dataUrl: string = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(file);
        });
        db.files[path] = dataUrl;
        persist();
        return { data: { path }, error: null };
      },
      getPublicUrl(path: string) {
        return { data: { publicUrl: db.files[path] ?? path } };
      },
      async remove(paths: string[]) {
        for (const p of paths) delete db.files[p];
        persist();
        return { data: null, error: null };
      },
    };
  },
};

const functions = {
  async invoke(name: string) {
    return {
      data: null,
      error: err(`"${name}" needs an internet connection and is disabled in offline mode. Please enter the details manually.`),
    };
  },
};

export const supabase: any = {
  from: (t: string) => new QueryBuilder(t),
  auth,
  rpc,
  storage,
  functions,
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
};

export default supabase;
