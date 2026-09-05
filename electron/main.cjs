const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");

// ERP screens do not need GPU acceleration. Disabling it avoids a common
// Electron/Windows GPU-driver freeze while keeping the app fully local.
app.disableHardwareAcceleration();

let mainWindow = null;

function getIndexPath() {
  // app.getAppPath() is reliable in both development and packaged builds.
  return path.join(app.getAppPath(), "dist-electron", "index.html");
}

async function showLoadError(win, details) {
  console.error("[electron] renderer load error:", details);
  if (!win || win.isDestroyed()) return;
  try {
    await dialog.showMessageBox(win, {
      type: "error",
      title: "Margin ERP could not start",
      message: "The desktop interface failed to load.",
      detail: `${details}\n\nTry starting the application again.`,
    });
  } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 650,
    show: true,
    autoHideMenuBar: true,
    title: "Margin ERP — Offline",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links are intentionally handed to the system browser.
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    void showLoadError(
      mainWindow,
      `Error ${errorCode}: ${errorDescription}\n${validatedURL}`,
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] renderer process exited:", details);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    void showLoadError(mainWindow, `Renderer process stopped: ${details.reason}`);
  });

  mainWindow.on("unresponsive", () => {
    console.error("[electron] renderer became unresponsive");
    // Never reload automatically while the user is interacting with the app.
    // A reload can destroy the focused input and makes keyboard stalls harder
    // to diagnose. Keep the renderer alive and log the event instead.
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const indexPath = getIndexPath();
  console.log("[electron] loading:", indexPath);
  mainWindow.loadFile(indexPath).catch((error) => {
    void showLoadError(mainWindow, error?.stack ?? String(error));
  });

  return mainWindow;
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
