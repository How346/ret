// Lets the cashier/owner customize the POS screen — hide/show parts of it,
// resize the three panels (Products / Cart / Summary), and save the result
// as a named template to switch between later. Stored in localStorage since
// this is a per-device preference (like the printer settings), not a shop
// policy that should sync to every till.

export type PosLayoutSections = {
  priceLevelTabs: boolean; // the Retail / Wholesale / MRP tab bar
  keypadHints: boolean; // the "F2 search · Ctrl+I all items · ..." hint strip
  gstBreakdown: boolean; // Subtotal / CGST / SGST rows in the Summary panel
  productImages: boolean; // product photos in the product grid
};

export type PosLayoutConfig = {
  // Where the POS barcode/search control is displayed. The existing "left"
  // position remains the default so the current POS look is preserved.
  searchPlacement?: "left" | "center";
  // Width of each of the 3 panels (Products, Cart, Summary) as percentages
  // that add up to 100.
  colPct: [number, number, number];
  sections: PosLayoutSections;
};

export const DEFAULT_POS_LAYOUT: PosLayoutConfig = {
  searchPlacement: "left",
  colPct: [33, 42, 25],
  sections: { priceLevelTabs: true, keypadHints: true, gstBreakdown: true, productImages: true },
};

export type PosPreset = {
  id: string;
  name: string;
  description: string;
  config: PosLayoutConfig;
};

// Built-in presets are read-only. They are added alongside the existing
// custom layout and saved templates, so the user's current look is never
// removed or overwritten.
export const POS_PRESETS: PosPreset[] = [
  {
    id: "professional",
    name: "Professional",
    description: "Centered scan/search bar with a clean billing workspace.",
    config: {
      searchPlacement: "center",
      colPct: [34, 41, 25],
      sections: { priceLevelTabs: true, keypadHints: true, gstBreakdown: true, productImages: true },
    },
  },
  {
    id: "classic-counter",
    name: "Classic Counter",
    description: "Fast counter layout with the familiar left-side scan/search area.",
    config: {
      searchPlacement: "left",
      colPct: [33, 42, 25],
      sections: { priceLevelTabs: true, keypadHints: true, gstBreakdown: true, productImages: false },
    },
  },
];

export function getPosPreset(id: string): PosPreset | null {
  return POS_PRESETS.find((p) => p.id === id) ?? null;
}

type Store = {
  active: PosLayoutConfig;
  templates: Record<string, PosLayoutConfig>;
};

const KEY = "margin-erp:pos-layout";
const MIN_PCT = 15;

function clampCols(cols: [number, number, number]): [number, number, number] {
  const sum = cols[0] + cols[1] + cols[2] || 100;
  const scaled = cols.map((c) => (c / sum) * 100) as [number, number, number];
  return scaled.map((c) => Math.max(MIN_PCT, Math.round(c * 10) / 10)) as [number, number, number];
}

function normalize(cfg: Partial<PosLayoutConfig> | null | undefined): PosLayoutConfig {
  const base = DEFAULT_POS_LAYOUT;
  return {
    searchPlacement: cfg?.searchPlacement === "center" ? "center" : base.searchPlacement,
    colPct: cfg?.colPct ? clampCols(cfg.colPct) : base.colPct,
    sections: { ...base.sections, ...(cfg?.sections ?? {}) },
  };
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { active: DEFAULT_POS_LAYOUT, templates: {} };
    const parsed = JSON.parse(raw);
    const templates: Record<string, PosLayoutConfig> = {};
    for (const [name, cfg] of Object.entries(parsed.templates ?? {})) {
      templates[name] = normalize(cfg as Partial<PosLayoutConfig>);
    }
    return { active: normalize(parsed.active), templates };
  } catch {
    return { active: DEFAULT_POS_LAYOUT, templates: {} };
  }
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore — private mode / storage unavailable */
  }
}

export function getActiveLayout(): PosLayoutConfig {
  return read().active;
}

export function setActiveLayout(cfg: PosLayoutConfig) {
  const s = read();
  s.active = normalize(cfg);
  write(s);
}

export function listTemplates(): { name: string; config: PosLayoutConfig }[] {
  const s = read();
  return Object.entries(s.templates)
    .map(([name, config]) => ({ name, config }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveTemplate(name: string, cfg: PosLayoutConfig) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const s = read();
  s.templates[trimmed] = normalize(cfg);
  write(s);
}

export function deleteTemplate(name: string) {
  const s = read();
  delete s.templates[name];
  write(s);
}

export function applyTemplate(name: string): PosLayoutConfig | null {
  const s = read();
  const cfg = s.templates[name];
  if (!cfg) return null;
  s.active = cfg;
  write(s);
  return cfg;
}
