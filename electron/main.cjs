const { app, BrowserWindow, shell, ipcMain, clipboard, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getHWID, readStoredLicenseAsync, installLicenseAsync, removeLicense } = require("./license.cjs");

let mainWindow = null;

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
        return {
          success: false,
          errorType: status.error || whatsappLastError || "WhatsApp is not connected. Scan the QR code in Settings → WhatsApp first.",
          qr: whatsappQrDataUrl,
        };
      }
    }

    // Validate the base64 payload before handing it to whatsapp-web.js.
    try { Buffer.from(base64Image, "base64"); } catch {
      return { success: false, errorType: "The generated bill image is invalid." };
    }

    let numberId;
    try {
      numberId = await whatsappClient.getNumberId(phone);
    } catch (error) {
      return { success: false, errorType: `Could not check the WhatsApp number: ${whatsappErrorMessage(error)}` };
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
    return { success: false, errorType: message };
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
// WhatsApp bill sharing (via the computer's own browser)
//
// WhatsApp has no public desktop API to auto-attach an image, so the
// practical, reliable approach is:
//   1. Render the bill HTML off-screen and capture it as an image, then put
//      that image on the OS clipboard.
//   2. Open WhatsApp Web using WhatsApp's own "click to chat" link
//      (web.whatsapp.com/send) in the user's own default browser — whichever
//      browser (Chrome, Edge, Firefox, ...) they've set as default on this
//      PC — with the message pre-filled. Their existing WhatsApp Web login
//      in that browser (if any) is used as-is; if not logged in yet, they
//      scan the QR code there once, same as always.
// The cashier then just presses Ctrl+V in the chat box and hits send — this
// keeps a human confirming every send instead of a script silently sending
// messages on the shop's behalf.
// ---------------------------------------------------------------------------

async function captureHtmlToClipboardImage(html, widthPx) {
  let tmpFile = null;
  let pngFile = null;
  let shotWin = null;
  try {
    tmpFile = path.join(os.tmpdir(), `margin-erp-wa-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    pngFile = path.join(os.tmpdir(), `margin-erp-wa-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(tmpFile, html, "utf8");

    // Use a real Chromium page instead of Electron's offscreen renderer. This
    // is considerably more reliable on Windows machines/drivers when the
    // resulting bitmap must be placed on the native Windows clipboard.
    shotWin = new BrowserWindow({
      show: false,
      width: Math.max(280, Number(widthPx) || 380),
      height: 900,
      x: -10000,
      y: -10000,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: "#ffffff",
      webPreferences: { contextIsolation: true, sandbox: true },
    });

    await shotWin.loadFile(tmpFile);
    await shotWin.webContents.executeJavaScript(`
      (async () => {
        try { if (document.fonts?.ready) await document.fonts.ready; } catch (_) {}
        const imgs = Array.from(document.images || []);
        await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => {
          img.addEventListener('load', r, { once: true });
          img.addEventListener('error', r, { once: true });
        })));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      })()
    `, true);

    const size = await shotWin.webContents.executeJavaScript(`({
      width: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0)),
      height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0))
    })`);
    const width = Math.max(280, Math.min(1200, Number(widthPx) || Number(size?.width) || 380));
    const height = Math.max(80, Math.min(6000, Number(size?.height) || 600));
    shotWin.setSize(width, height);

    await shotWin.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);

    // A short showInactive() makes Chromium paint a hidden/off-screen window
    // consistently without putting it in front of the cashier.
    try { shotWin.showInactive(); } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 80));

    const image = await shotWin.webContents.capturePage({ x: 0, y: 0, width, height });
    if (!image || image.isEmpty()) return false;

    const png = image.toPNG();
    fs.writeFileSync(pngFile, png);

    // Primary native Electron clipboard path.
    try {
      clipboard.writeImage(image);
      if (!clipboard.readImage().isEmpty()) return true;
    } catch { /* fall through to Windows clipboard fallback */ }

    // Windows fallback: System.Windows.Forms writes the actual bitmap to the
    // Windows clipboard. This helps on PCs where Chromium/Electron's clipboard
    // bridge is blocked by another clipboard manager or driver.
    if (process.platform === "win32") {
      try {
        const { spawnSync } = require("node:child_process");
        const psPath = pngFile.replace(/'/g, "''");
        const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${psPath}'); try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }`;
        const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", command], { windowsHide: true, timeout: 10000 });
        if (result.status === 0) return true;
      } catch { /* fall through */ }
    }

    return false;
  } catch {
    return false;
  } finally {
    try { if (shotWin && !shotWin.isDestroyed()) shotWin.destroy(); } catch { /* ignore */ }
    try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { if (pngFile && fs.existsSync(pngFile)) fs.unlinkSync(pngFile); } catch { /* ignore */ }
  }
}

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

// Opens WhatsApp Web in the user's own default browser so they can log in
// (scan the QR code) there — exactly like opening web.whatsapp.com in a
// normal browser tab. Whichever browser is set as default on this PC is
// used; Electron does not embed or control it.
ipcMain.handle("whatsapp:open-web", async () => {
  try {
    await shell.openExternal("https://web.whatsapp.com/");
    return { success: true };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err) };
  }
});

// Captures the bill as an image (copied to clipboard), then opens the
// customer's WhatsApp Web chat in the user's default browser with the
// message pre-filled, ready for the cashier to paste the image and send.
ipcMain.handle("whatsapp:send-image", async (_event, payload) => {
  const imageDataUrl = String((payload && payload.imageDataUrl) || "");
  let phone = String((payload && payload.phone) || "").replace(/[^\d]/g, "");
  if (phone.length === 10) phone = `91${phone}`;
  else if (phone.length === 11 && phone.startsWith("0")) phone = `91${phone.slice(1)}`;
  else if (phone.startsWith("00")) phone = phone.slice(2);
  const message = String((payload && payload.message) || "");
  const html = String((payload && payload.html) || "");
  const widthPx = Math.max(280, Math.min(1200, Number(payload && payload.widthPx) || 380));

  if (!phone) return { success: false, errorType: "missing-phone" };

  // An empty/invalid image isn't fatal — it just means the clipboard step is
  // skipped and we fall through to the PDF fallback below, so the cashier
  // still gets something usable instead of nothing at all.
  let imaged = false;
  let tmpPngFile = null;
  if (imageDataUrl.startsWith("data:image/")) {
    try {
      const image = nativeImage.createFromDataURL(imageDataUrl);
      if (!image.isEmpty()) {
        clipboard.writeImage(image);
        imaged = !clipboard.readImage().isEmpty();

        // Windows fallback: some PCs have Chromium/Electron's clipboard
        // bridge blocked by another clipboard manager/driver, even though
        // the image itself decoded fine. Writing the bitmap directly via
        // .NET's clipboard API sidesteps that.
        if (!imaged && process.platform === "win32") {
          try {
            tmpPngFile = path.join(os.tmpdir(), `margin-erp-wa-img-${Date.now()}.png`);
            fs.writeFileSync(tmpPngFile, image.toPNG());
            const { spawnSync } = require("node:child_process");
            const psPath = tmpPngFile.replace(/'/g, "''");
            const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${psPath}'); try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }`;
            const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", command], { windowsHide: true, timeout: 10000 });
            if (result.status === 0) imaged = true;
          } catch {
            /* fall through to PDF */
          }
        }
      }
    } catch {
      imaged = false;
    } finally {
      try { if (tmpPngFile && fs.existsSync(tmpPngFile)) fs.unlinkSync(tmpPngFile); } catch { /* ignore */ }
    }
  }

  let pdfOpened = false;
  if (!imaged && html) pdfOpened = !!(await createBillPdf(html, widthPx));

  // wa.me is the most reliable external hand-off: the user's default browser
  // resolves it to WhatsApp Web/Desktop depending on their setup.
  try {
    const chatUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    await shell.openExternal(chatUrl);
    return { success: true, imaged, pdfOpened, url: chatUrl };
  } catch (err) {
    try {
      const fallbackUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
      await shell.openExternal(fallbackUrl);
      return { success: true, imaged, pdfOpened, url: fallbackUrl, fallback: true };
    } catch (err2) {
      return { success: false, errorType: String((err2 && err2.message) || err2 || err), imaged, pdfOpened };
    }
  }
});

ipcMain.handle("whatsapp:send-web", async (_event, payload) => {
  const html = (payload && payload.html) || "";
  const phone = String((payload && payload.phone) || "").replace(/[^\d]/g, "");
  const message = (payload && payload.message) || "";
  const widthPx = Math.max(280, Math.min(1200, Number(payload && payload.widthPx) || 380));

  if (!phone) return { success: false, errorType: "missing-phone" };

  const imaged = await captureHtmlToClipboardImage(html, widthPx);
  let pdfOpened = false;

  // If the native image clipboard still cannot be written, create a real PDF
  // as a reliable fallback and open it. The cashier can attach that PDF from
  // WhatsApp's document picker instead of being left with a broken action.
  if (!imaged) {
    pdfOpened = !!(await createBillPdf(html, widthPx));
  }

  try {
    const chatUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    await shell.openExternal(chatUrl);
    return { success: true, imaged, pdfOpened };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err), imaged, pdfOpened };
  }
});
