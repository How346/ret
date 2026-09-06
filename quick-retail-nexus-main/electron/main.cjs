const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");

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

  win.once("ready-to-show", () => win.maximize());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "..", "dist-electron", "index.html"));
}

function mmToMicrons(mm) {
  return Math.max(1000, Math.round(Number(mm || 0) * 1000));
}

ipcMain.handle("print-html", async (_event, payload) => {
  const html = typeof payload?.html === "string" ? payload.html : "";
  const options = payload?.options || {};
  if (!html) throw new Error("Nothing to print");

  const printWin = new BrowserWindow({
    show: false,
    width: 1000,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await printWin.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
    await new Promise((resolve) => {
      if (printWin.webContents.isLoading()) {
        printWin.webContents.once("did-finish-load", resolve);
      } else {
        resolve();
      }
    });

    await new Promise((resolve, reject) => {
      const printOptions = {
        silent: false,
        printBackground: true,
        color: false,
      };

      if (options.paperWidthMm && options.paperHeightMm) {
        printOptions.pageSize = {
          width: mmToMicrons(options.paperWidthMm),
          height: mmToMicrons(options.paperHeightMm),
        };
      }

      printWin.webContents.print(printOptions, (success, reason) => {
        if (success) resolve();
        else reject(new Error(reason || "Printing was cancelled or failed"));
      });
    });

    return { ok: true };
  } finally {
    if (!printWin.isDestroyed()) printWin.close();
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
