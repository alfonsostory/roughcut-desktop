import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import electronUpdater from "electron-updater";
import { createTranscriptionServer } from "../transcription/server.mjs";
import { createManualUpdateChecker } from "./updates.mjs";

const LIVE_APP_URL = "https://roughcut-phase-one-demo.alfonsostory.chatgpt.site/";
const MEDIA_PORT = Number(process.env.ROUGHCUT_TRANSCRIBER_PORT ?? 4317);
// Repository that publishes the desktop installers and their update manifests.
const UPDATE_REPOSITORY = process.env.ROUGHCUT_UPDATE_REPOSITORY ?? "alfonsostory/roughcut-desktop";
const UPDATE_CHECK_DELAY = 4000;
let mediaServer;
let mainWindow;

app.commandLine.appendSwitch("disable-features", "BlockInsecurePrivateNetworkRequests");

async function startMediaService() {
  process.env.ROUGHCUT_MODEL_CACHE ??= path.join(app.getPath("userData"), "models");
  const server = createTranscriptionServer();
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error?.code === "EADDRINUSE") resolve();
      else reject(error);
    };
    server.once("error", onError);
    server.listen(MEDIA_PORT, "127.0.0.1", () => {
      server.off("error", onError);
      mediaServer = server;
      resolve();
    });
  });
}

// Windows installers update in place. Unsigned macOS builds cannot, so those
// users are offered the published download instead of a silent replacement.
function startUpdateChecks() {
  if (!app.isPackaged) return;

  if (process.platform === "win32") {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.on("error", (error) => console.error("Update check failed:", error));
    autoUpdater.on("update-downloaded", async (info) => {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Roughcut ${info.version} is ready to install.`,
        detail: "Roughcut will restart to finish the update. Rendered previews are not affected.",
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    setTimeout(() => void autoUpdater.checkForUpdates(), UPDATE_CHECK_DELAY);
    return;
  }

  const checkForManualUpdate = createManualUpdateChecker({
    repository: UPDATE_REPOSITORY,
    currentVersion: app.getVersion(),
    fetchImpl: (...args) => fetch(...args),
    openExternal: (url) => shell.openExternal(url),
    logError: (error) => console.error("Update check failed:", error),
    askToDownload: async ({ version, currentVersion }) => {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Open download page", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update available",
        message: `Roughcut ${version} is available.`,
        detail: `This computer runs ${currentVersion}. Download the new version, then drag it into Applications to replace the current app.`,
      });
      return response === 0;
    },
  });
  setTimeout(() => void checkForManualUpdate(), UPDATE_CHECK_DELAY);
}

function createWindow() {
  const appUrl = process.env.ROUGHCUT_DESKTOP_URL ?? LIVE_APP_URL;
  const trustedOrigin = new URL(appUrl).origin;
  mainWindow = new BrowserWindow({
    title: "Roughcut",
    width: 1480,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#f3f0e9",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The trusted hosted UI talks only to the private loopback media service.
      webSecurity: false,
    },
  });
  mainWindow.webContents.setUserAgent(`${mainWindow.webContents.getUserAgent()} RoughcutDesktop/${app.getVersion()}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== trustedOrigin) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });
  void mainWindow.loadURL(appUrl);
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    await startMediaService();
    createWindow();
    startUpdateChecks();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on("before-quit", () => {
  mediaServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
