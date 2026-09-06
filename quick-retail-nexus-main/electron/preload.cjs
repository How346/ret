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

  // Renders a receipt/bill HTML string to an image, copies it to the
  // clipboard, and opens a WhatsApp chat for the given phone number with the
  // message pre-filled — so the cashier just has to paste (Ctrl+V) the image
  // into the chat and hit send.
  // Resolves to { success: boolean, errorType?: string }.
  sendReceiptWhatsApp: (html, phone, message, widthPx) =>
    ipcRenderer.invoke("whatsapp:send-receipt", { html, phone, message, widthPx }),
});
