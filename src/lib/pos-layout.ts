// POS layout presets are intentionally limited to two polished, cashier-friendly
// templates. The active selection is stored per device in localStorage.

export type PosLayoutSections = {
  priceLevelTabs: boolean;
  keypadHints: boolean;
  gstBreakdown: boolean;
  productImages: boolean;
};

export type PosLayoutConfig = {
  colPct: [number, number, number];
  sections: PosLayoutSections;
};

export type PosLayoutTemplate = {
  id: "counter-pro" | "modern-pro";
  name: string;
  description: string;
  config: PosLayoutConfig;
};

export const POS_LAYOUT_TEMPLATES: PosLayoutTemplate[] = [
  {
    id: "counter-pro",
    name: "Counter Pro",
    description: "Fast billing layout with a large centred scan/search bar and compact product cards.",
    config: {
      colPct: [34, 43, 23],
      sections: { priceLevelTabs: true, keypadHints: true, gstBreakdown: true, productImages: false },
    },
  },
  {
    id: "modern-pro",
    name: "Modern Pro",
    description: "Premium visual layout with a centred scan/search bar and image-rich product grid.",
    config: {
      colPct: [38, 42, 20],
      sections: { priceLevelTabs: true, keypadHints: false, gstBreakdown: true, productImages: true },
    },
  },
];

export const DEFAULT_POS_LAYOUT: PosLayoutConfig = POS_LAYOUT_TEMPLATES[0].config;

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
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function getActiveLayout(): PosLayoutConfig {
  return read().active;
}

export function setActiveLayout(cfg: PosLayoutConfig) {
  const s = read();
  s.active = normalize(cfg);
  write(s);
}

// Kept for compatibility with older saved layouts. Built-in templates are the
// only templates exposed by the POS UI now.
export function listTemplates(): { name: string; config: PosLayoutConfig }[] {
  return Object.entries(read().templates)
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
  const builtIn = POS_LAYOUT_TEMPLATES.find((t) => t.name === name);
  const cfg = builtIn?.config ?? read().templates[name];
  if (!cfg) return null;
  const normalized = normalize(cfg);
  const s = read();
  s.active = normalized;
  write(s);
  return normalized;
}
