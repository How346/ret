const { app, BrowserWindow, shell, ipcMain, clipboard } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
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
// WhatsApp bill sharing
//
// IMPORTANT: WhatsApp Web is NEVER embedded inside the Electron app.
// The user's selected browser is launched externally, so WhatsApp uses the
// normal browser profile/session (Chrome/Edge/Firefox/etc.) on this PC.
// ---------------------------------------------------------------------------

function findExecutable(executableNames, extraPaths = []) {
  const candidates = [...extraPaths];

  if (process.platform === "win32") {
    for (const name of executableNames) {
      try {
        const result = execFileSync("where.exe", [name], {
          encoding: "utf8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim().split(/\r?\n/)[0];
        if (result) candidates.push(result);
      } catch {
        /* not in PATH */
      }
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore invalid paths */
    }
  }
  return null;
}

function getWhatsAppBrowsers() {
  const env = process.env;
  const pf = env.ProgramFiles || "C:\\Program Files";
  const pfx86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = env.LOCALAPPDATA || path.join(env.USERPROFILE || "", "AppData", "Local");

  const definitions = [
    {
      id: "edge",
      name: "Microsoft Edge",
      exe: ["msedge.exe"],
      paths: [
        path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
      ],
    },
    {
      id: "chrome",
      name: "Google Chrome",
      exe: ["chrome.exe"],
      paths: [
        path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      ],
    },
    {
      id: "brave",
      name: "Brave",
      exe: ["brave.exe"],
      paths: [
        path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(pfx86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      ],
    },
    {
      id: "firefox",
      name: "Mozilla Firefox",
      exe: ["firefox.exe"],
      paths: [
        path.join(pf, "Mozilla Firefox", "firefox.exe"),
        path.join(pfx86, "Mozilla Firefox", "firefox.exe"),
      ],
    },
    {
      id: "opera",
      name: "Opera",
      exe: ["opera.exe", "launcher.exe"],
      paths: [
        path.join(local, "Programs", "Opera", "opera.exe"),
        path.join(pf, "Opera", "launcher.exe"),
        path.join(pfx86, "Opera", "launcher.exe"),
      ],
    },
    {
      id: "vivaldi",
      name: "Vivaldi",
      exe: ["vivaldi.exe"],
      paths: [
        path.join(local, "Vivaldi", "Application", "vivaldi.exe"),
        path.join(pf, "Vivaldi", "Application", "vivaldi.exe"),
        path.join(pfx86, "Vivaldi", "Application", "vivaldi.exe"),
      ],
    },
  ];

  return definitions
    .map((b) => ({ id: b.id, name: b.name, path: findExecutable(b.exe, b.paths) }))
    .filter((b) => !!b.path);
}

function openWhatsAppInBrowser(url, browserId) {
  if (!url) throw new Error("Missing WhatsApp URL");

  if (!browserId || browserId === "default") {
    return shell.openExternal(url);
  }

  const browser = getWhatsAppBrowsers().find((b) => b.id === browserId);
  if (!browser || !browser.path) {
    // If the selected browser was uninstalled, gracefully fall back to the
    // operating system's default browser instead of opening WhatsApp in Electron.
    return shell.openExternal(url);
  }

  const child = spawn(browser.path, [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return true;
}

ipcMain.handle("whatsapp:browsers", async () => {
  try {
    return [
      { id: "default", name: "System default browser" },
      ...getWhatsAppBrowsers().map(({ id, name }) => ({ id, name })),
    ];
  } catch {
    return [{ id: "default", name: "System default browser" }];
  }
});

ipcMain.handle("whatsapp:open-web", async (_event, payload) => {
  try {
    const browserId = String((payload && payload.browserId) || "default");
    openWhatsAppInBrowser("https://web.whatsapp.com/", browserId);
    return { success: true };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err) };
  }
});

ipcMain.handle("whatsapp:send-web", async (_event, payload) => {
  const html = (payload && payload.html) || "";
  const phone = String((payload && payload.phone) || "").replace(/[^\d]/g, "");
  const message = (payload && payload.message) || "";
  const browserId = String((payload && payload.browserId) || "default");
  const widthPx = Math.max(280, Math.min(1200, Number(payload && payload.widthPx) || 380));

  if (!phone) return { success: false, errorType: "missing-phone" };

  // Keep the useful bill-image workflow: render the receipt and put it on
  // the OS clipboard. The external browser can paste it into WhatsApp Web.
  const imaged = await captureHtmlToClipboardImage(html, widthPx);

  try {
    const chatUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    openWhatsAppInBrowser(chatUrl, browserId);
    return { success: true, imaged };
  } catch (err) {
    return { success: false, errorType: String((err && err.message) || err), imaged };
  }
});
