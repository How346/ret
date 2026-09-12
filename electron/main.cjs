const { app, BrowserWindow, shell, ipcMain, clipboard, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getHWID, readStoredLicenseAsync, installLicenseAsync, removeLicense } = require("./license.cjs");

process.on("unhandledRejection", (reason) => {
  const safe = whatsappErrorMessage(reason);
  console.error("[Margin ERP] Unhandled rejection:", safe);
  try { sendWhatsAppEvent("whatsapp-error", { error: safe }); } catch {}
});

process.on("uncaughtException", (error) => {
  const safe = whatsappErrorMessage(error);
  console.error("[Margin ERP] Uncaught exception:", safe);
  try { sendWhatsAppEvent("whatsapp-error", { error: safe }); } catch {}
});

let mainWindow = null;

// ---------------------------------------------------------------------------
// Background WhatsApp bill-image sender (Baileys)
// ---------------------------------------------------------------------------
// Baileys talks to WhatsApp over WebSockets and does not launch Chromium.
// The authenticated Signal keys are stored locally under Electron's userData.

let baileys = null;
let baileysPino = null;
let QRCode = null;
let whatsappSocket = null;
let whatsappReady = false;
let whatsappQrDataUrl = null;
let whatsappInitializing = false;
let whatsappInitPromise = null;
let whatsappLastError = null;
let whatsappReconnectTimer = null;
let whatsappReconnectAttempts = 0;

async function loadWhatsAppDependencies() {
  try {
    if (!baileys) baileys = await import("@whiskeysockets/baileys");
    if (!baileysPino) baileysPino = (await import("pino")).default;
    if (!QRCode) QRCode = require("qrcode");
    return { baileys, pino: baileysPino, QRCode };
  } catch (error) {
    const e = new Error(
      `WhatsApp dependency error: ${error?.message || error}. Run "bun install" before building the Windows app.`
    );
    e.cause = error;
    throw e;
  }
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

function whatsappJidFromPhone(phone) {
  return `${phone}@s.whatsapp.net`;
}

function whatsappErrorMessage(error) {
  if (error == null) return "Unknown WhatsApp error";

  const candidates = [
    error?.message,
    error?.output?.payload?.message,
    error?.output?.payload?.error,
    error?.output?.message,
    error?.data?.message,
    typeof error === "string" ? error : null,
  ].filter((value) => value != null && String(value).trim());

  const message = String(candidates[0] || "Unknown WhatsApp error").trim();

  if (/cannot find module.*baileys/i.test(message)) {
    return "WhatsApp Baileys module is missing. Run bun install and rebuild the Windows app.";
  }
  if (/logged out|401/i.test(message)) {
    return "WhatsApp was logged out. Connect WhatsApp again from Settings → WhatsApp.";
  }
  if (/connection closed|428|405|connection failure/i.test(message)) {
    return "WhatsApp connection closed. Please wait a moment and try again. If this continues, reconnect WhatsApp from Settings → WhatsApp.";
  }
  return message;
}


function whatsappStatusCode(error) {
  return error?.output?.statusCode ?? error?.data?.statusCode ?? error?.statusCode ?? null;
}

function clearWhatsAppReconnectTimer() {
  if (whatsappReconnectTimer) {
    clearTimeout(whatsappReconnectTimer);
    whatsappReconnectTimer = null;
  }
}

function destroyWhatsAppSocket() {
  const socket = whatsappSocket;
  whatsappSocket = null;
  whatsappReady = false;
  try { socket?.end?.(undefined); } catch { /* socket is already closed */ }
}

async function clearWhatsAppAuthState() {
  try {
    const authPath = path.join(app.getPath("userData"), "whatsapp-baileys-auth");
    await fs.promises.rm(authPath, { recursive: true, force: true });
  } catch { /* best effort; next connection can still report the real error */ }
}

function scheduleWhatsAppReconnect() {
  clearWhatsAppReconnectTimer();
  if (whatsappReconnectTimer || whatsappInitializing) return;
  whatsappReconnectAttempts = Math.min(whatsappReconnectAttempts + 1, 8);
  const delay = Math.min(1500 * Math.pow(1.6, whatsappReconnectAttempts - 1), 15000);
  whatsappReconnectTimer = setTimeout(() => {
    whatsappReconnectTimer = null;
    void initializeWhatsApp({ silent: true });
  }, delay);
}

async function initializeWhatsApp(options = {}) {
  if (whatsappReady && whatsappSocket) return { ready: true, qr: null };
  if (whatsappInitPromise) return whatsappInitPromise;

  whatsappInitPromise = (async () => {
    whatsappInitializing = true;
    whatsappLastError = null;
    // Resolves as soon as the very first connection outcome is known (open,
    // QR needed, or closed/errored) so callers get an accurate ready state
    // instead of a stale "not connected" while the handshake is still in
    // flight in the background. Bounded by a timeout so a hung network can
    // never block the caller forever.
    let settleFirstOutcome = () => {};
    const firstOutcome = new Promise((resolve) => { settleFirstOutcome = resolve; });
    let firstOutcomeSettled = false;
    const settleOnce = () => {
      if (firstOutcomeSettled) return;
      firstOutcomeSettled = true;
      settleFirstOutcome();
    };
    try {
      const { baileys: b, pino, QRCode: qrCode } = await loadWhatsAppDependencies();
      const {
        DisconnectReason,
        useMultiFileAuthState,
        makeCacheableSignalKeyStore,
        Browsers,
        fetchLatestWaWebVersion,
      } = b;
      const makeWASocket = b.default || b.makeWASocket;

      if (typeof makeWASocket !== "function") {
        throw new Error("Baileys makeWASocket export is unavailable. Reinstall dependencies and rebuild.");
      }

      const authPath = path.join(app.getPath("userData"), "whatsapp-baileys-auth");
      await fs.promises.mkdir(authPath, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const logger = pino({ level: "silent" });

      whatsappQrDataUrl = null;
      whatsappReady = false;
      destroyWhatsAppSocket();

      // WhatsApp Web changes its client revision frequently. Using the bundled
      // revision can cause fresh pairing/connection failures. Prefer the live
      // WhatsApp Web revision, but never block startup if the network is down.
      let waVersion;
      if (typeof fetchLatestWaWebVersion === "function") {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const latest = await Promise.race([
              fetchLatestWaWebVersion(),
              new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("WA version lookup timed out")), { once: true })),
            ]);
            if (Array.isArray(latest?.version) && latest.version.length === 3) {
              waVersion = latest.version;
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          // Offline startup is still supported; Baileys will use its bundled version.
        }
      }

      whatsappSocket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        ...(waVersion ? { version: waVersion } : {}),
        logger,
        browser: Browsers?.windows?.("Margin ERP Offline") || ["Windows", "Chrome", "Margin ERP Offline"],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        fireInitQueries: true,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 250,
        emitOwnEvents: false,
      });

      const socket = whatsappSocket;
      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        try {
          const { connection, lastDisconnect, qr } = update || {};

          if (qr) {
          whatsappReady = false;
          try {
            whatsappQrDataUrl = await qrCode.toDataURL(qr, {
              margin: 1,
              width: 320,
              errorCorrectionLevel: "M",
            });
            sendWhatsAppEvent("whatsapp-qr", whatsappQrDataUrl);
          } catch (error) {
            whatsappLastError = whatsappErrorMessage(error);
            sendWhatsAppEvent("whatsapp-error", { error: whatsappLastError });
          }
          // A QR means the handshake needs a scan before it can proceed —
          // that is a known, final outcome for this call, not a connection.
          settleOnce();
        }

        if (connection === "open") {
          whatsappReady = true;
          whatsappQrDataUrl = null;
          whatsappLastError = null;
          whatsappReconnectAttempts = 0;
          clearWhatsAppReconnectTimer();
          sendWhatsAppEvent("whatsapp-ready", { ready: true });
          settleOnce();
          return;
        }

        if (connection === "close") {
          whatsappReady = false;
          whatsappQrDataUrl = null;

          const statusCode = whatsappStatusCode(lastDisconnect?.error);
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const connectionReplaced = statusCode === DisconnectReason.connectionReplaced;
          const reason = loggedOut
            ? "WhatsApp session was logged out. Connect again from Settings → WhatsApp."
            : connectionReplaced
              ? "WhatsApp connection was replaced by another linked session."
              : whatsappErrorMessage(lastDisconnect?.error || "Connection closed");

          whatsappLastError = reason;
          sendWhatsAppEvent("whatsapp-disconnected", { reason, loggedOut, statusCode });
          destroyWhatsAppSocket();

          if (loggedOut) {
            await clearWhatsAppAuthState();
            whatsappReconnectAttempts = 0;
            sendWhatsAppEvent("whatsapp-error", { error: reason });
          } else if (!connectionReplaced) {
            scheduleWhatsAppReconnect();
          } else {
            sendWhatsAppEvent("whatsapp-error", { error: reason });
          }
          settleOnce();
          }
        } catch (handlerError) {
          const safeError = whatsappErrorMessage(handlerError);
          whatsappLastError = safeError;
          sendWhatsAppEvent("whatsapp-error", { error: safeError });
          settleOnce();
        }
      });

      // Keep this listener intentionally small. We do not download/sync chat history.
      socket.ev.on("messages.update", () => {});

      if (state.creds.registered) {
        sendWhatsAppEvent("whatsapp-authenticated", { authenticated: true });
      }

      // Wait for the handshake to actually resolve (connected, needs a QR
      // scan, or failed) before reporting a status. Without this, the very
      // first call of a session would return "not ready" immediately — even
      // though the socket goes on to connect a moment later in the
      // background — which is why only the *second* bill previously showed
      // WhatsApp as connected.
      await Promise.race([
        firstOutcome,
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]);

      return {
        ready: whatsappReady,
        qr: whatsappQrDataUrl,
        error: whatsappLastError || undefined,
      };
    } catch (error) {
      whatsappLastError = whatsappErrorMessage(error);
      destroyWhatsAppSocket();
      sendWhatsAppEvent("whatsapp-error", { error: whatsappLastError });
      return { ready: false, qr: whatsappQrDataUrl, error: whatsappLastError };
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

// Completely reset only the Baileys WhatsApp session. This is useful when a
// previous/corrupt linked-device state is left behind after an app upgrade.
ipcMain.handle("whatsapp:reset", async () => {
  try {
    clearWhatsAppReconnectTimer();
    destroyWhatsAppSocket();
    await clearWhatsAppAuthState();
    whatsappQrDataUrl = null;
    whatsappLastError = null;
    whatsappReconnectAttempts = 0;
    return await initializeWhatsApp();
  } catch (error) {
    const safeError = whatsappErrorMessage(error);
    whatsappLastError = safeError;
    return { ready: false, qr: null, error: safeError };
  }
});

// Sends one WhatsApp message containing the complete PNG bill and the configured
// message as its caption. The PNG stays in memory and is never written to disk.
ipcMain.handle("send-bill-image", async (_event, payload) => {
  try {
    const raw = String(payload?.base64Image || "").trim();
    const base64Image = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    const phone = cleanWhatsAppPhone(payload?.phone);
    const message = String(payload?.message || "").trim();

    if (!base64Image) return { success: false, errorType: "Bill image is empty." };
    if (!phone) return { success: false, errorType: "WhatsApp number is empty or invalid." };
    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      return { success: false, errorType: "WhatsApp number must include a valid country code." };
    }

    const imageBuffer = Buffer.from(base64Image, "base64");
    if (!imageBuffer.length) return { success: false, errorType: "Bill image could not be decoded." };
    if (imageBuffer.length > 15 * 1024 * 1024) {
      return { success: false, errorType: "Bill image is too large. Reduce the invoice image size and try again." };
    }

    if (!whatsappSocket || !whatsappReady) {
      const status = await initializeWhatsApp();
      if (!status.ready || !whatsappSocket || !whatsappReady) {
        return {
          success: false,
          errorType: status.error || "WhatsApp is not connected. Scan the QR code in Settings → WhatsApp first.",
          qr: whatsappQrDataUrl,
        };
      }
    }

    const jid = whatsappJidFromPhone(phone);
    const socket = whatsappSocket;
    if (!socket) return { success: false, errorType: "WhatsApp connection is unavailable. Try again." };

    // Verify the number first so an invalid/non-WhatsApp number produces a clear
    // error instead of a confusing send failure.
    let resolvedJid = jid;
    try {
      if (typeof socket.onWhatsApp === "function") {
        const result = await socket.onWhatsApp(jid);
        const firstResult = Array.isArray(result) ? result[0] : null;
        if (firstResult && firstResult.exists === false) {
          return { success: false, errorType: "This phone number is not registered on WhatsApp." };
        }
        if (firstResult?.jid) resolvedJid = firstResult.jid;
      }
    } catch {
      // A transient lookup failure should not block a valid send; send using the
      // canonical PN JID and let WhatsApp return the definitive result.
    }

    const sendPayload = {
      image: imageBuffer,
      mimetype: "image/png",
      fileName: "bill.png",
      ...(message ? { caption: message } : {}),
    };

    const sendOnce = async (activeSocket) => Promise.race([
      activeSocket.sendMessage(resolvedJid, sendPayload),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("WhatsApp send timed out. Please try again.")), 45000)
      ),
    ]);

    let sendResult;
    try {
      sendResult = await sendOnce(socket);
    } catch (firstSendError) {
      const firstMessage = whatsappErrorMessage(firstSendError);
      const looksLikeClosedConnection = /connection closed|connection failure|timed out|reading 'message'/i.test(firstMessage);
      if (!looksLikeClosedConnection) throw firstSendError;

      // The socket can become stale between the ready check and media upload.
      // Reconnect once and retry the same in-memory image instead of exposing a
      // raw Baileys null/connection error to the cashier.
      whatsappReady = false;
      const status = await initializeWhatsApp({ silent: true });
      if (!status.ready || !whatsappSocket) {
        throw new Error(status.error || "WhatsApp connection was lost. Please try again.");
      }
      sendResult = await sendOnce(whatsappSocket);
    }

    if (!sendResult) {
      return { success: false, errorType: "WhatsApp did not return a send result." };
    }

    return {
      success: true,
      imaged: true,
      messaged: !!message,
      messageId: sendResult?.key?.id || null,
    };
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
  let shown = false;
  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    try { win.show(); win.maximize(); } catch {}
  };
  win.once("ready-to-show", showWindow);
  win.webContents.once("did-finish-load", showWindow);
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[Margin ERP] renderer failed to load: ${errorCode} ${errorDescription} ${validatedURL}`);
    // A transient file-load failure should not leave the desktop app invisible.
    setTimeout(() => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.loadFile(path.join(__dirname, "..", "dist-electron", "index.html")).catch((error) => console.error("[Margin ERP] renderer retry failed", error));
      }
    }, 250);
  });
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
  process.on("exit", () => { try { destroyWhatsAppSocket(); } catch {} });
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
