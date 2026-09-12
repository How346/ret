// Preload script — runs in an isolated context with access to Node/Electron
// APIs, and exposes a small, safe surface to the renderer (the React app)
// via contextBridge. This is what lets window.electronAPI.printHTML(...)
// work from src/lib/print-dispatch.ts without turning on nodeIntegration.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  // Offline signed-license API. The private signing key is NEVER exposed here.
  getHWID: () => ipcRenderer.invoke("license:hwid"),
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),
  installLicense: (licenseText) => ipcRenderer.invoke("license:install", licenseText),
  removeLicense: () => ipcRenderer.invoke("license:remove"),
  syncLicenseTime: () => ipcRenderer.invoke("license:status"),

  // Returns the list of printers installed on this machine:
  // [{ name, displayName, isDefault, status }]
  listPrinters: () => ipcRenderer.invoke("printers:list"),

  // Prints an HTML string. options: { deviceName?, silent?, copies? }
  // Resolves to { success: boolean, errorType?: string }.
  printHTML: (html, options) => ipcRenderer.invoke("print:html", { html, options }),
  // Sends raw TSPL/.PRN bytes to the Windows print spooler. The printer
  // is selected in Settings; no WebUSB pairing is needed.
  printRaw: (data, options) => ipcRenderer.invoke("print:raw", { data, options }),

  // Background Baileys integration. No Chromium/Puppeteer process is used.
  // The QR is returned as a data URL and bill images are sent with the
  // configured message as the WhatsApp image caption.
  initializeWhatsApp: () => ipcRenderer.invoke("whatsapp:initialize"),
  getWhatsAppStatus: () => ipcRenderer.invoke("whatsapp:status"),
  resetWhatsApp: () => ipcRenderer.invoke("whatsapp:reset"),
  // Render the receipt with Chromium in the main process. This avoids the
  // renderer line/border artefacts seen in WhatsApp bill PNGs.
  renderBillImage: (html, widthPx) =>
    ipcRenderer.invoke("render-bill-image", { html, widthPx }),
  sendBillImage: (base64Image, phone, message) =>
    ipcRenderer.invoke("send-bill-image", { base64Image, phone, message }),
  onWhatsAppQr: (callback) => {
    const listener = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on("whatsapp-qr", listener);
    return () => ipcRenderer.removeListener("whatsapp-qr", listener);
  },
  onWhatsAppReady: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("whatsapp-ready", listener);
    return () => ipcRenderer.removeListener("whatsapp-ready", listener);
  },
  onWhatsAppError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("whatsapp-error", listener);
    return () => ipcRenderer.removeListener("whatsapp-error", listener);
  },
});
