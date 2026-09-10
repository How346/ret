const { app, BrowserWindow, shell, ipcMain, clipboard, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getHWID, readStoredLicenseAsync, installLicenseAsync, removeLicense } = require("./license.cjs");

let mainWindow = null;
let whatsappWindow = null;

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
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      await whatsappWindow.loadURL("https://web.whatsapp.com/");
      whatsappWindow.show(); whatsappWindow.focus();
      return { success: true, mode: "embedded-web" };
    }
    whatsappWindow = new BrowserWindow({
      width: 1280, height: 900, minWidth: 900, minHeight: 650,
      show: false, autoHideMenuBar: true, title: "WhatsApp Web",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:whatsapp" }
    });
    whatsappWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
    whatsappWindow.on("closed", () => { whatsappWindow = null; });
    whatsappWindow.webContents.setWindowOpenHandler(({ url }) => { if (url && /^https?:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
    await whatsappWindow.loadURL("https://web.whatsapp.com/");
    whatsappWindow.show(); whatsappWindow.focus();
    return { success: true, mode: "embedded-web" };
  } catch (err) {
    try { await shell.openExternal("https://web.whatsapp.com/"); return { success: true, mode: "desktop-browser" }; }
    catch (err2) { return { success: false, errorType: String((err2 && err2.message) || err2 || err) }; }
  }
});

async function openWhatsAppChat(phone, message = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { success: false, errorType: "missing-phone" };
  const url = `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(String(message || ""))}`;

  // Primary approach: open WhatsApp Web in a dedicated Chromium window with
  // its own persistent session. This avoids Windows default-browser/URL
  // association problems and keeps the WhatsApp login available next time.
  try {
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      await whatsappWindow.loadURL(url);
      whatsappWindow.show();
      whatsappWindow.focus();
      return { success: true, mode: "embedded-web", url };
    }

    whatsappWindow = new BrowserWindow({
      width: 1280, height: 900, minWidth: 900, minHeight: 650,
      show: false, autoHideMenuBar: true, title: "WhatsApp Web",
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: "persist:whatsapp",
      },
    });
    whatsappWindow.webContents.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    );
    whatsappWindow.on("closed", () => { whatsappWindow = null; });
    whatsappWindow.webContents.setWindowOpenHandler(({ url: childUrl }) => {
      if (childUrl && /^https?:\/\//.test(childUrl)) shell.openExternal(childUrl);
      return { action: "deny" };
    });
    await whatsappWindow.loadURL(url);
    whatsappWindow.show();
    whatsappWindow.focus();
    return { success: true, mode: "embedded-web", url };
  } catch (embeddedError) {
    // Fallback: installed WhatsApp Desktop or the system browser.
    try {
      await shell.openExternal(`whatsapp://send?phone=${digits}&text=${encodeURIComponent(String(message || ""))}`);
      return { success: true, mode: "desktop-app", url };
    } catch {
      try {
        await shell.openExternal(`https://wa.me/${digits}?text=${encodeURIComponent(String(message || ""))}`);
        return { success: true, mode: "desktop-browser", url };
      } catch (err) {
        return { success: false, errorType: String((err && err.message) || embeddedError || err) };
      }
    }
  }
}

// Captures the bill as an image (copied to clipboard), then opens the
// customer's WhatsApp chat using WhatsApp Desktop when available, otherwise
// a dedicated WhatsApp Web window inside the app.
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
  if (!imageDataUrl.startsWith("data:image/")) return { success: false, errorType: "invalid-image-data" };

  let imaged = false;
  try {
    const image = nativeImage.createFromDataURL(imageDataUrl);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      imaged = !clipboard.readImage().isEmpty();
    }
  } catch {
    imaged = false;
  }

  let pdfOpened = false;
  if (!imaged && html) pdfOpened = !!(await createBillPdf(html, widthPx));

  const opened = await openWhatsAppChat(phone, message);
  return { ...opened, imaged, pdfOpened };
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

  const opened = await openWhatsAppChat(phone, message);
  return { ...opened, imaged, pdfOpened };
});
