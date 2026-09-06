const { app, BrowserWindow, shell, ipcMain, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let mainWindow = null;

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
// WhatsApp bill sharing (via an embedded, persistently-logged-in WhatsApp Web)
//
// WhatsApp has no public desktop API to auto-attach an image, so the
// practical, reliable approach is:
//   1. Keep one WhatsApp Web window open in a dedicated, persistent session
//      (its own Chromium "partition") — the cashier scans the QR code once
//      and stays logged in across app restarts, just like the real
//      web.whatsapp.com in a browser tab.
//   2. Render the bill HTML off-screen and capture it as an image, then put
//      that image on the OS clipboard.
//   3. Navigate that same logged-in window straight to the customer's chat
//      using WhatsApp's own "click to chat" link (web.whatsapp.com/send),
//      with the message pre-filled.
// The cashier then just presses Ctrl+V in the chat box and hits send — this
// keeps a human confirming every send instead of a script silently sending
// messages on the shop's behalf.
// ---------------------------------------------------------------------------

let waWebWindow = null;

function getOrCreateWhatsAppWebWindow() {
  if (waWebWindow && !waWebWindow.isDestroyed()) return waWebWindow;
  waWebWindow = new BrowserWindow({
    width: 980,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    title: "WhatsApp Web — Margin ERP",
    webPreferences: {
      // Its own persistent partition: login (cookies/localStorage) is saved
      // to disk and survives app restarts, separate from the main app.
      partition: "persist:whatsapp-web",
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  waWebWindow.on("closed", () => {
    waWebWindow = null;
  });
  waWebWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  return waWebWindow;
}

async function captureHtmlToClipboardImage(html, widthPx) {
  let tmpFile = null;
  let shotWin = null;
  try {
    tmpFile = path.join(os.tmpdir(), `margin-erp-wa-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(tmpFile, html, "utf8");

    shotWin = new BrowserWindow({
      show: false,
      width: widthPx,
      height: 100,
      webPreferences: { contextIsolation: true, sandbox: true },
    });

    await shotWin.loadFile(tmpFile);

    // Let images/barcodes/fonts settle, then size the window to the full
    // rendered height so the capture isn't cropped.
    await new Promise((r) => setTimeout(r, 150));
    const contentHeight = await shotWin.webContents.executeJavaScript(
      "Math.ceil(document.documentElement.scrollHeight)",
    );
    const height = Math.max(100, Math.min(6000, Number(contentHeight) || 600));
    shotWin.setContentSize(widthPx, height);
    await new Promise((r) => setTimeout(r, 100));

    const image = await shotWin.webContents.capturePage();
    clipboard.writeImage(image);
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => {
      try {
        if (shotWin && !shotWin.isDestroyed()) shotWin.destroy();
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
}

// Opens (or brings to front) the persistent WhatsApp Web window so the user
// can scan the QR code and log in. Safe to call repeatedly — it reuses the
// same window/session and won't reload (and lose) an already-open chat.
ipcMain.handle("whatsapp:open-web", async () => {
  try {
    const win = getOrCreateWhatsAppWebWindow();
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || !/whatsapp\.com/.test(currentUrl)) {
      await win.loadURL("https://web.whatsapp.com/");
    }
    win.show();
    win.focus();
    return { success: true };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err) };
  }
});

// Captures the bill as an image (copied to clipboard), then opens the same
// logged-in WhatsApp Web window straight to the given customer's chat with
// the message pre-filled, ready for the cashier to paste the image and send.
ipcMain.handle("whatsapp:send-web", async (_event, payload) => {
  const html = (payload && payload.html) || "";
  const phone = String((payload && payload.phone) || "").replace(/[^\d]/g, "");
  const message = (payload && payload.message) || "";
  const widthPx = Math.max(280, Math.min(1200, Number(payload && payload.widthPx) || 380));

  if (!phone) return { success: false, errorType: "missing-phone" };

  const imaged = await captureHtmlToClipboardImage(html, widthPx);

  try {
    const win = getOrCreateWhatsAppWebWindow();
    const chatUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    await win.loadURL(chatUrl);
    win.show();
    win.focus();
    return { success: true, imaged };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err), imaged };
  }
});
