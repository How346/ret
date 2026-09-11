const FONT_SCALE_KEY = "margin-erp:font-scale";
const DEFAULT_FONT_SCALE = 1;

export function getFontScale(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_SCALE;
  const value = Number(window.localStorage.getItem(FONT_SCALE_KEY));
  if (!Number.isFinite(value)) return DEFAULT_FONT_SCALE;
  return Math.min(1.2, Math.max(0.85, value));
}

export function setFontScale(value: number) {
  const scale = Math.min(1.2, Math.max(0.85, Number(value) || DEFAULT_FONT_SCALE));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FONT_SCALE_KEY, String(scale));
    document.documentElement.style.setProperty("--app-font-scale", String(scale));
    window.dispatchEvent(new CustomEvent("margin-erp:font-scale", { detail: scale }));
  }
  return scale;
}

export function applyStoredFontScale() {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-scale", String(getFontScale()));
}
