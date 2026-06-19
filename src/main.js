const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 180,
    height: 220,
    minWidth: 140,
    minHeight: 160,
    title: 'Tiny Doodle',
    frame: false,          // custom minimal frame
    resizable: true,
    alwaysOnTop: false,    // toggled by pin button
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // mainWindow.webContents.openDevTools({ mode: 'detach' }); // debug only
}

// ---------- Auto-update (GitHub Releases via electron-updater) ----------
// Only runs in an installed/packaged build; in `npm start` dev mode there is
// no update feed, so we skip it to avoid noisy "dev-app-update.yml" errors.
function setupAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Tiny Doodle ${info.version} is ready to install.`,
      detail: 'Restart the app now to apply the update, or it will install automatically next time you quit.'
    });
    if (choice === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    // Stay silent in the UI; just log. A failed update check should never
    // block the user from drawing.
    console.error('Auto-update error:', err == null ? 'unknown' : (err.stack || err).toString());
  });

  // Check shortly after launch so startup isn't delayed.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates failed:', err);
  });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers for custom title bar / pin / window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('toggle-pin', (event, shouldPin) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(shouldPin);
});

ipcMain.on('window-drag-start', () => {
  // handled via CSS -webkit-app-region: drag in renderer
});
