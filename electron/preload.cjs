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

  // Opens WhatsApp Web in the browser selected in Settings.
  // WhatsApp is never embedded inside Electron.
  openWhatsAppWeb: (browserId) => ipcRenderer.invoke("whatsapp:open-web", { browserId }),

  // Returns browsers detected on this PC.
  listWhatsAppBrowsers: () => ipcRenderer.invoke("whatsapp:browsers"),

  // Captures the bill HTML as an image (copied to the clipboard), then
  // navigates the same logged-in WhatsApp Web window straight to the given
  // phone number's chat with the message pre-filled. The cashier pastes
  // (Ctrl+V) the image into the chat and sends it themselves.
  // Resolves to { success: boolean, errorType?: string, imaged?: boolean }.
  sendReceiptWhatsAppWeb: (html, phone, message, widthPx, browserId) =>
    ipcRenderer.invoke("whatsapp:send-web", { html, phone, message, widthPx, browserId }),
});
