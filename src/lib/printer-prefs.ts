// Per-device printer preferences for the Electron/offline desktop build.
//
// Deliberately NOT stored in store_settings (Supabase / offline DB): the
// printers attached to a till are a property of *this PC*, not of the shop,
// so they must not sync between registers. Kept in localStorage instead.

export type PrinterInfo = {
  name: string;
  displayName: string;
  isDefault: boolean;
  status?: number;
};

type ElectronPrintAPI = {
  isElectron: true;
  listPrinters: () => Promise<PrinterInfo[]>;
  printHTML: (
    html: string,
    options?: { deviceName?: string; silent?: boolean; copies?: number },
  ) => Promise<{ success: boolean; errorType?: string }>;
  openWhatsAppWeb: () => Promise<{ success: boolean; errorType?: string }>;
  sendReceiptWhatsAppWeb: (
    html: string,
    phone: string,
    message: string,
    widthPx?: number,
  ) => Promise<{ success: boolean; errorType?: string; imaged?: boolean; pdfOpened?: boolean }>;
  getHWID: () => Promise<{ hwid: string }>;
  getLicenseStatus: () => Promise<OfflineLicenseStatus>;
  installLicense: (licenseText: string) => Promise<OfflineLicenseStatus>;
  removeLicense: () => Promise<OfflineLicenseStatus>;
};

export type OfflineLicenseStatus = {
  valid: boolean;
  reason?: string;
  daysLeft?: number;
  fileName?: string;
  payload?: {
    v: number;
    product: string;
    licenseId: string;
    hwid: string;
    plan: string;
    issuedAt: string;
    expiresAt: string;
    features: string[];
  };
};

declare global {
  interface Window {
    electronAPI?: ElectronPrintAPI;
  }
}

export function isDesktopPrintingAvailable(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.printHTML;
}

export async function listPrinters(): Promise<PrinterInfo[]> {
  if (!isDesktopPrintingAvailable()) return [];
  try {
    return (await window.electronAPI!.listPrinters()) || [];
  } catch {
    return [];
  }
}

type StoredPrefs = {
  receiptPrinter: string | null; // OS printer "name" (device name), null = ask each time
  labelPrinter: string | null;
  silent: boolean; // skip the OS print dialog and print straight to the chosen printer
};

const KEY = "margin-erp:printer-prefs";

function readPrefs(): StoredPrefs {
  const fallback: StoredPrefs = { receiptPrinter: null, labelPrinter: null, silent: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function writePrefs(patch: Partial<StoredPrefs>) {
  try {
    const next = { ...readPrefs(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore (private mode / storage unavailable) */
  }
}

export function getPrinterPrefs(): StoredPrefs {
  return readPrefs();
}

export function setReceiptPrinter(name: string | null) {
  writePrefs({ receiptPrinter: name });
}

export function setLabelPrinter(name: string | null) {
  writePrefs({ labelPrinter: name });
}

export function setSilentPrint(silent: boolean) {
  writePrefs({ silent });
}
