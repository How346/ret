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

  // Renders a receipt/bill HTML string to an image and copies it to the
  // clipboard, ready to paste — see openWhatsAppWeb/sendReceiptWhatsAppWeb
  // below for the actual WhatsApp Web send flow.
  // Opens WhatsApp Web in the user's own default browser on this PC (not an
  // embedded window) so they can scan the QR code and log in, same as
  // opening web.whatsapp.com in any ordinary browser tab.
  // Resolves to { success: boolean, errorType?: string }.
  openWhatsAppWeb: () => ipcRenderer.invoke("whatsapp:open-web"),

  // Captures the bill HTML as an image (copied to the clipboard), then opens
  // the given phone number's WhatsApp Web chat in the user's default
  // browser with the message pre-filled. The cashier pastes (Ctrl+V) the
  // image into the chat and sends it themselves.
  // Resolves to { success: boolean, errorType?: string, imaged?: boolean }.
  sendReceiptWhatsAppWeb: (html, phone, message, widthPx) =>
    ipcRenderer.invoke("whatsapp:send-web", { html, phone, message, widthPx }),

  // Renderer html2canvas image -> main-process nativeImage -> OS clipboard.
  sendReceiptWhatsAppImage: (imageDataUrl, phone, message, html, widthPx) =>
    ipcRenderer.invoke("whatsapp:send-image", { imageDataUrl, phone, message, html, widthPx }),
  // Background whatsapp-web.js integration. The QR is returned as a data URL
  // and never opens a browser window. Bill images are sent with the configured
  // message as the WhatsApp image caption.
  initializeWhatsApp: () => ipcRenderer.invoke("whatsapp:initialize"),
  getWhatsAppStatus: () => ipcRenderer.invoke("whatsapp:status"),
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
