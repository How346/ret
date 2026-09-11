const { app, BrowserWindow, shell, ipcMain, clipboard, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getHWID, readStoredLicenseAsync, installLicenseAsync, removeLicense } = require("./license.cjs");

let mainWindow = null;

// Puppeteer/whatsapp-web.js occasionally rejects promises tied to page
// lifecycle events (e.g. a background frame navigating away) outside the
// normal call chain we can wrap in try/catch. Without this, Electron shows a
// raw, cryptic native error dialog and can bring down the whole app over a
// WhatsApp hiccup that has nothing to do with billing. Log and continue.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});

// ---------------------------------------------------------------------------
// Background WhatsApp bill-image sender (whatsapp-web.js)
// ---------------------------------------------------------------------------

const WHATSAPP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let whatsappWebJs = null;
let QRCode = null;
let puppeteer = null;
let whatsappClient = null;
let whatsappReady = false;
let whatsappQrDataUrl = null;
let whatsappInitializing = false;
let whatsappInitPromise = null;
let whatsappLastError = null;

function loadWhatsAppDependencies() {
  try {
    if (!whatsappWebJs) whatsappWebJs = require("whatsapp-web.js");
    if (!QRCode) QRCode = require("qrcode");
    if (!puppeteer) puppeteer = require("puppeteer");
    return { whatsappWebJs, QRCode, puppeteer };
  } catch (error) {
    const e = new Error(
      `WhatsApp dependency error: ${error?.message || error}. Run "bun install" before building the Windows app.`
    );
    e.cause = error;
    throw e;
  }
}

function findChromeExecutable() {
  const candidates = [];
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || "";
    candidates.push(
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return null;
}

function resolveWhatsAppBrowser() {
  const { puppeteer: p } = loadWhatsAppDependencies();
  try {
    const bundled = typeof p.executablePath === "function" ? p.executablePath() : null;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch { /* Puppeteer cache may not be present in the packaged app. */ }
  const system = findChromeExecutable();
  if (system) return system;
  throw new Error(
    "No Chromium/Chrome browser was found for WhatsApp. Install Google Chrome or Microsoft Edge, then restart the billing software."
  );
}

function sendWhatsAppEvent(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function cleanWhatsAppPhone(phone) {
  let clean = String(phone || "").replace(/[^\d]/g, "");
  if (clean.startsWith("00")) clean = clean.slice(2);
  if (clean.length === 10) clean = `91${clean}`;
  if (clean.length === 11 && clean.startsWith("0")) clean = `91${clean.slice(1)}`;
  return clean;
}

function whatsappErrorMessage(error) {
  if (!error) return "Unknown WhatsApp error";
  const message = String(error?.message || error);
  const stack = String(error?.stack || "");
  if (/cannot find module.*whatsapp-web\.js/i.test(message)) {
    return "WhatsApp module is missing. Run bun install and rebuild the Windows app.";
  }
  if (/could not find chrome|failed to launch the browser|executable doesn't exist/i.test(message)) {
    return "WhatsApp browser could not start. Install/update Google Chrome or Microsoft Edge and restart the app.";
  }
  if (/execution context was destroyed|protocol error|target closed|session closed/i.test(message)) {
    return "WhatsApp's connection dropped mid-request. Please try sending again.";
  }
  if (/detached frame|navigating frame was detached/i.test(message)) {
    return "WhatsApp Web reloaded unexpectedly. Please try sending again in a moment.";
  }
  if (/timeout|timed out/i.test(message)) {
    return "WhatsApp took too long to respond. Check your internet connection and try again.";
  }
  if (/evaluation failed/i.test(message)) {
    return "WhatsApp Web didn't respond as expected (it may have updated). Please try again, or reconnect in Settings → WhatsApp.";
  }
  return stack && stack !== message ? message : message;
}

function resetWhatsAppClient() {
  whatsappReady = false;
  whatsappQrDataUrl = null;
  const client = whatsappClient;
  whatsappClient = null;
  try { client?.removeAllListeners?.(); } catch { /* ignore */ }
  try { client?.destroy?.(); } catch { /* ignore */ }
}

async function initializeWhatsApp() {
  if (whatsappReady && whatsappClient) return { ready: true, qr: null };
  if (whatsappInitPromise) return whatsappInitPromise;

  whatsappInitPromise = (async () => {
    whatsappInitializing = true;
    whatsappLastError = null;
    try {
      const { whatsappWebJs: wjs, QRCode: qrCode } = loadWhatsAppDependencies();
      const { Client, LocalAuth } = wjs;
      const executablePath = resolveWhatsAppBrowser();
      const sessionPath = path.join(app.getPath("userData"), "whatsapp-session");

      resetWhatsAppClient();
      whatsappClient = new Client({
        authStrategy: new LocalAuth({ clientId: "margin-erp", dataPath: sessionPath }),
        puppeteer: {
          headless: true,
          executablePath,
          timeout: 60000,
          protocolTimeout: 120000,
          dumpio: false,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-agent=${WHATSAPP_USER_AGENT}`,
          ],
        },
      });

      whatsappClient.on("qr", async (qr) => {
        whatsappReady = false;
        try {
          whatsappQrDataUrl = await qrCode.toDataURL(qr, {
            margin: 1, width: 320, errorCorrectionLevel: "M",
          });
          sendWhatsAppEvent("whatsapp-qr", whatsappQrDataUrl);
        } catch (error) {
          whatsappLastError = whatsappErrorMessage(error);
          sendWhatsAppEvent("whatsapp-error", { error: whatsappLastError });
        }
      });

      whatsappClient.on("authenticated", () => {
        sendWhatsAppEvent("whatsapp-authenticated", { authenticated: true });
      });

      whatsappClient.on("ready", () => {
        whatsappReady = true;
        whatsappLastError = null;
        whatsappQrDataUrl = null;
        sendWhatsAppEvent("whatsapp-ready", { ready: true });
      });

      whatsappClient.on("auth_failure", (message) => {
        whatsappReady = false;
        whatsappQrDataUrl = null;
        whatsappLastError = `WhatsApp authentication failed: ${String(message || "Unknown authentication failure")}`;
        sendWhatsAppEvent("whatsapp-error", { error: whatsappLastError });
      });

      whatsappClient.on("disconnected", (reason) => {
        whatsappReady = false;
        whatsappQrDataUrl = null;
        whatsappLastError = `WhatsApp disconnected: ${String(reason || "Disconnected")}`;
        sendWhatsAppEvent("whatsapp-disconnected", { reason: String(reason || "Disconnected") });
        resetWhatsAppClient();
      });

      whatsappClient.on("change_state", (state) => {
        sendWhatsAppEvent("whatsapp-state", { state: String(state || "") });
      });

      await whatsappClient.initialize();
      return { ready: whatsappReady, qr: whatsappQrDataUrl, error: whatsappLastError || undefined };
    } catch (error) {
      whatsappLastError = whatsappErrorMessage(error);
      resetWhatsAppClient();
      sendWhatsAppEvent("whatsapp-error", { error: whatsappLastError });
      return { ready: false, qr: null, error: whatsappLastError };
    } finally {
      whatsappInitializing = false;
      whatsappInitPromise = null;
    }
  })();

  return whatsappInitPromise;
}

ipcMain.handle("whatsapp:initialize", async () => initializeWhatsApp());

ipcMain.handle("whatsapp:status", async () => ({
  ready: whatsappReady,
  qr: whatsappQrDataUrl,
  initializing: whatsappInitializing,
  error: whatsappLastError,
}));

// Send ONLY the bill image. No text/caption and no physical bill image file.
ipcMain.handle("send-bill-image", async (_event, payload) => {
  const html = String(payload?.html || "");
  const widthPx = Math.max(280, Math.min(1200, Number(payload?.widthPx) || 380));
  try {
    const { MessageMedia } = loadWhatsAppDependencies().whatsappWebJs;
    const raw = String(payload?.base64Image || "").trim();
    const base64Image = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    const phone = cleanWhatsAppPhone(payload?.phone);

    if (!base64Image) return { success: false, errorType: "Bill image is empty." };
    if (!phone) return { success: false, errorType: "WhatsApp number is empty or invalid." };
    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      return { success: false, errorType: "WhatsApp number must include a valid country code." };
    }

    if (!whatsappClient || !whatsappReady) {
      const status = await initializeWhatsApp();
      if (!status.ready || !whatsappClient || !whatsappReady) {
        const pdfOpened = html ? !!(await createBillPdf(html, widthPx)) : false;
        return {
          success: false,
          errorType: status.error || whatsappLastError || "WhatsApp is not connected. Scan the QR code in Settings → WhatsApp first.",
          qr: whatsappQrDataUrl,
          pdfOpened,
        };
      }
    }

    // Validate the base64 payload before handing it to whatsapp-web.js.
    try { Buffer.from(base64Image, "base64"); } catch {
      return { success: false, errorType: "The generated bill image is invalid." };
    }

    // getNumberId can transiently fail right after the client becomes
    // "ready" with errors like "Execution context was destroyed" while
    // WhatsApp Web's own page is still settling — one retry after a short
    // pause resolves the vast majority of these without bothering the user.
    let numberId;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        numberId = await whatsappClient.getNumberId(phone);
        break;
      } catch (error) {
        if (attempt === 1) {
          const pdfOpened = html ? !!(await createBillPdf(html, widthPx)) : false;
          return { success: false, errorType: `Could not check the WhatsApp number: ${whatsappErrorMessage(error)}`, pdfOpened };
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (!numberId?._serialized) {
      return { success: false, errorType: "This number is not available on WhatsApp." };
    }

    const media = new MessageMedia("image/png", base64Image, "bill.png");
    await whatsappClient.sendMessage(numberId._serialized, media, { sendMediaAsDocument: false });
    return { success: true, phone };
  } catch (error) {
    const message = whatsappErrorMessage(error);
    whatsappLastError = message;
    sendWhatsAppEvent("whatsapp-error", { error: message });
    const pdfOpened = html ? !!(await createBillPdf(html, widthPx)) : false;
    return { success: false, errorType: message, pdfOpened };
  }
});

// ---------------------------------------------------------------------------
// Offline signed licensing
// ---------------------------------------------------------------------------

ipcMain.handle("license:hwid", async () => ({ hwid: getHWID() }));
ipcMain.handle("license:status", async () => readStoredLicenseAsync(app));
ipcMain.handle("license:install", async (_event, licenseText) => {
  try {
    return await installLicenseAsync(app, String(licenseText || ""));
  } catch (error) {
    return { valid: false, reason: error?.message || "Invalid license" };
  }
});
ipcMain.handle("license:remove", async () => removeLicense(app));

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    title: "Margin ERP — Offline",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow = win;
  win.once("ready-to-show", () => win.maximize());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "..", "dist-electron", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Printing (invoices / receipts / barcode labels)
//
// The renderer used to call window.open() + window.print(), which the app's
// own setWindowOpenHandler above blocks (every popup is denied), so nothing
// ever happened when "Print" was clicked in the packaged desktop app. These
// IPC handlers do real, native printing instead: they list the printers
// installed on this PC and send a print job — with an OS printer-selection
// dialog by default — to whichever one the user picks.
// ---------------------------------------------------------------------------

ipcMain.handle("printers:list", async () => {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: !!p.isDefault,
      status: p.status,
    }));
  } catch {
    return [];
  }
});

ipcMain.handle("print:html", async (_event, payload) => {
  const html = (payload && payload.html) || "";
  const opts = (payload && payload.options) || {};

  let tmpFile = null;
  let printWin = null;
  try {
    tmpFile = path.join(os.tmpdir(), `margin-erp-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(tmpFile, html, "utf8");

    printWin = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });

    await printWin.loadFile(tmpFile);

    const printOptions = {
      silent: !!opts.silent,
      printBackground: true,
      copies: Math.max(1, Number(opts.copies) || 1),
      margins: { marginType: "none" },
    };
    if (opts.deviceName) printOptions.deviceName = opts.deviceName;

    const result = await new Promise((resolve) => {
      printWin.webContents.print(printOptions, (success, errorType) => {
        resolve({ success, errorType: success ? undefined : errorType });
      });
    });
    return result;
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err) };
  } finally {
    setTimeout(() => {
      try {
        if (printWin && !printWin.isDestroyed()) printWin.destroy();
      } catch {
        /* ignore */
      }
      try {
        if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }, 1500);
  }
});

// ---------------------------------------------------------------------------
// PDF fallback for WhatsApp bill sending
//
// If the whatsapp-web.js/Puppeteer session can't send the image directly
// (not logged in, browser missing, WhatsApp Web changed something under us,
// etc.), we generate a real PDF of the bill and open it so the cashier can
// still attach it manually from WhatsApp's own document picker instead of
// being left with nothing.
// ---------------------------------------------------------------------------

async function createBillPdf(html, widthPx) {
  let tmpFile = null;
  let pdfWin = null;
  try {
    tmpFile = path.join(os.tmpdir(), `margin-erp-bill-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    const pdfFile = path.join(app.getPath("temp"), `Margin-ERP-Bill-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, html, "utf8");
    pdfWin = new BrowserWindow({
      show: false,
      width: Math.max(280, Number(widthPx) || 380),
      height: 900,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await pdfWin.loadFile(tmpFile);
    await pdfWin.webContents.executeJavaScript(`document.fonts?.ready ? document.fonts.ready : Promise.resolve()`);
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(pdfFile, pdf);
    await shell.openPath(pdfFile);
    return pdfFile;
  } catch {
    return null;
  } finally {
    try { if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy(); } catch { /* ignore */ }
    try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
