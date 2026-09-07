const { app, BrowserWindow, shell, ipcMain, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getHWID, readStoredLicense, installLicense, removeLicense } = require("./license.cjs");

let mainWindow = null;

// ---------------------------------------------------------------------------
// Offline signed licensing
// ---------------------------------------------------------------------------

ipcMain.handle("license:hwid", async () => ({ hwid: getHWID() }));
ipcMain.handle("license:status", async () => readStoredLicense(app));
ipcMain.handle("license:install", async (_event, licenseText) => {
  try {
    return installLicense(app, String(licenseText || ""));
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

function waitForNextPaint(win, timeoutMs, fallbackImage) {
  return new Promise((resolve) => {
    let done = false;
    const handler = (_e, _dirty, img) => {
      if (done) return;
      done = true;
      try { win.webContents.removeListener("paint", handler); } catch { /* ignore */ }
      resolve(img);
    };
    win.webContents.on("paint", handler);
    setTimeout(() => {
      if (done) return;
      done = true;
      try { win.webContents.removeListener("paint", handler); } catch { /* ignore */ }
      resolve(fallbackImage ?? null);
    }, timeoutMs);
  });
}

async function captureHtmlToClipboardImage(html, widthPx) {
  let tmpFile = null;
  let shotWin = null;
  try {
    tmpFile = path.join(os.tmpdir(), `margin-erp-wa-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(tmpFile, html, "utf8");

    // Offscreen rendering (webPreferences.offscreen) is Electron's own
    // purpose-built mechanism for capturing a page with no visible window
    // at all — it always paints to an in-memory buffer, regardless of the
    // window's on-screen visibility. A previous version of this used a
    // normal window pushed off-screen + capturePage(), which some Windows
    // GPU/driver combinations never actually composite (so the clipboard
    // stayed empty); OSR avoids that failure mode entirely.
    shotWin = new BrowserWindow({
      show: false,
      width: widthPx,
      height: 60,
      webPreferences: { contextIsolation: true, sandbox: true, offscreen: true },
    });

    let lastFrame = null;
    shotWin.webContents.on("paint", (_event, _dirty, image) => {
      lastFrame = image;
    });
    shotWin.webContents.setFrameRate(30);

    await shotWin.loadFile(tmpFile);
    // Let barcodes/images/fonts settle and give OSR its first paint.
    await waitForNextPaint(shotWin, 800, lastFrame);

    const contentHeight = await shotWin.webContents.executeJavaScript(
      "Math.ceil(document.documentElement.scrollHeight)",
    );
    const height = Math.max(60, Math.min(6000, Number(contentHeight) || 600));
    shotWin.setSize(widthPx, height);

    // Resizing triggers new paints at the final size; wait for one, and
    // force a repaint if nothing usable arrives on its own.
    let image = await waitForNextPaint(shotWin, 900, null);
    if ((!image || image.isEmpty() || image.getSize().height < height - 20) && !shotWin.isDestroyed()) {
      shotWin.webContents.invalidate();
      image = await waitForNextPaint(shotWin, 900, null);
    }
    if (!image) image = lastFrame;
    if (!image || image.isEmpty()) return false;

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
    }, 800);
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
ipcMain.handle("whatsapp:send-web", async (_event, payload) => {
  const html = (payload && payload.html) || "";
  const phone = String((payload && payload.phone) || "").replace(/[^\d]/g, "");
  const message = (payload && payload.message) || "";
  const widthPx = Math.max(280, Math.min(1200, Number(payload && payload.widthPx) || 380));

  if (!phone) return { success: false, errorType: "missing-phone" };

  const imaged = await captureHtmlToClipboardImage(html, widthPx);

  try {
    const chatUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    await shell.openExternal(chatUrl);
    return { success: true, imaged };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err), imaged };
  }
});
