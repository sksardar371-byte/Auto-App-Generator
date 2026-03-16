const path = require("path");
const { app, BrowserWindow } = require("electron");

let mainWindow = null;

function resolveFrontendEntry() {
  const packagedBuild = path.join(process.resourcesPath, "frontend-build", "index.html");
  const localBuild = path.join(__dirname, "..", "frontend", "build", "index.html");

  if (app.isPackaged) {
    return { type: "file", value: packagedBuild };
  }
  return { type: "file", value: localBuild };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entry = resolveFrontendEntry();
  if (entry.type === "file") {
    mainWindow.loadFile(entry.value).catch(() => {
      const devUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";
      mainWindow.loadURL(devUrl);
    });
  } else {
    mainWindow.loadURL(entry.value);
  }
}

app.whenReady().then(() => {
  // Start backend API in the same process.
  // server.js starts Express immediately.
  // eslint-disable-next-line global-require
  require(path.join(__dirname, "server.js"));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
