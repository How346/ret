// Preload script — runs in an isolated context with access to Node/Electron
// APIs, and exposes a small, safe surface to the renderer (the React app)
// via contextBridge. This is what lets window.electronAPI.printHTML(...)
// work from src/lib/print-dispatch.ts without turning on nodeIntegration.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  // Returns the list of printers installed on this machine:
  // [{ name, displayName, isDefault, status }]
  listPrinters: () => ipcRenderer.invoke("printers:list"),

  // Prints an HTML string. options: { deviceName?, silent?, copies? }
  // Resolves to { success: boolean, errorType?: string }.
  printHTML: (html, options) => ipcRenderer.invoke("print:html", { html, options }),
});
