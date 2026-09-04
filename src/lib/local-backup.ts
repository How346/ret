// Local-folder backup for Margin ERP.
//
// Uses the browser's File System Access API (Chrome/Edge/Opera 86+).
// The user picks a folder ONCE; we store the FileSystemDirectoryHandle in
// IndexedDB so the app remembers it across reloads. Every backup writes a
// dated JSON file into that folder, so the shop's data lives on their own
// PC and is not lost even if the cloud is down.
//
// A .bat file is also produced so the shopkeeper can double-click it to
// open the backup folder from Windows Explorer.

import { supabase } from "@/integrations/supabase/client";

type DirHandle = FileSystemDirectoryHandle;

const DB = "margin-erp-local";
const STORE = "handles";
const KEY = "backup-dir";

// ---------- IndexedDB tiny helper ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    tx.onsuccess = () => res(tx.result as T);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbSet(key: string, val: unknown) {
  const db = await idb();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
    tx.onsuccess = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(key: string) {
  const db = await idb();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    tx.onsuccess = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- Public API ----------
export function backupSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickBackupFolder(): Promise<DirHandle> {
  // @ts-expect-error - Chromium-only API
  const handle: DirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(KEY, handle);
  return handle;
}

export async function getSavedFolder(): Promise<DirHandle | null> {
  const h = await idbGet<DirHandle>(KEY);
  return h ?? null;
}

export async function forgetFolder() { await idbDel(KEY); }

async function ensureRW(dir: DirHandle): Promise<boolean> {
  // @ts-expect-error
  const perm = await dir.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  // @ts-expect-error
  const req = await dir.requestPermission({ mode: "readwrite" });
  return req === "granted";
}

async function getOrCreateSub(dir: DirHandle, name: string): Promise<DirHandle> {
  return await dir.getDirectoryHandle(name, { create: true });
}

async function writeFile(dir: DirHandle, name: string, content: string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

const TABLES = [
  "store_settings", "categories", "suppliers", "customers",
  "products", "purchases", "purchase_items",
  "sales", "sale_items", "stock_ledger",
] as const;

export type BackupResult = { folder: string; file: string; tables: Record<string, number> };

export async function runBackup(): Promise<BackupResult> {
  const dir = await getSavedFolder();
  if (!dir) throw new Error("No backup folder chosen yet");
  if (!(await ensureRW(dir))) throw new Error("Permission denied for backup folder");

  const root = await getOrCreateSub(dir, "MarginERP-Backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const dump: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select("*");
    if (error) throw new Error(`${t}: ${error.message}`);
    dump[t] = data ?? [];
    counts[t] = data?.length ?? 0;
  }
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    counts,
    data: dump,
  };
  const fname = `margin-erp-${stamp}.json`;
  await writeFile(root, fname, JSON.stringify(payload, null, 2));

  // Also write a small .bat opener the shop can double-click
  await writeFile(
    root,
    "Open Backup Folder.bat",
    `@echo off\r\nstart "" "%~dp0"\r\n`,
  );
  // README
  await writeFile(
    root,
    "README.txt",
    [
      "Margin ERP - Local Backups",
      "==========================",
      "Each margin-erp-*.json file is a full snapshot of your shop data",
      "(products, sales, customers, purchases, settings).",
      "",
      "To restore: open Margin ERP -> Settings -> Store Data -> Restore.",
      "Keep these files safe. Copy them to a pen-drive or Google Drive as extra safety.",
    ].join("\r\n"),
  );

  return { folder: "MarginERP-Backups", file: fname, tables: counts };
}

export async function restoreBackup(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || !parsed.data) throw new Error("Not a valid backup file");
  // NOTE: restore is a delicate operation; we upsert per-table so unique
  // constraints (barcode/sku/name) merge cleanly. It DOES NOT delete rows
  // that exist in DB but not in the backup.
  const results: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = parsed.data[t] as any[] | undefined;
    if (!rows?.length) { results[t] = 0; continue; }
    const { error } = await supabase.from(t).upsert(rows as any, { onConflict: "id" });
    if (error) throw new Error(`${t}: ${error.message}`);
    results[t] = rows.length;
  }
  return results;
}
