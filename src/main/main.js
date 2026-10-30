'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs/promises');
const pdfops = require('./pdfops');
const { buildMenu } = require('./menu');
const settings = require('./settings');

const APP_NAME = 'Katip PDF';
const windows = new Set();
const pendingFiles = new Map(); // webContents.id -> file path to open after load

const APP_ROOT = path.join(__dirname, '..', '..');
const APP_URL = 'katip://app/src/renderer/index.html';
// Only these folders of the application are reachable through the katip:// scheme.
const SERVED_DIRS = ['src', path.join('node_modules', 'pdfjs-dist')].map((d) => path.join(APP_ROOT, d) + path.sep);

protocol.registerSchemesAsPrivileged([
  { scheme: 'katip', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

app.setName(APP_NAME);
// Lets automated tests run with an isolated settings folder.
if (process.env.KATIP_USER_DATA) app.setPath('userData', process.env.KATIP_USER_DATA);
if (process.platform === 'win32') app.setAppUserModelId('com.katip.pdf');

function pdfArgsFrom(argv) {
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf'))
    .map((a) => path.resolve(a));
}

function createWindow(filePath) {
  const state = settings.get('windowState', { width: 1280, height: 860, maximized: false });
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f3f4f6',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  windows.add(win);
  if (filePath) pendingFiles.set(win.webContents.id, filePath);
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    // Ask renderer whether there are unsaved changes.
    win.webContents.send('app:request-close');
  });
  win.on('closed', () => windows.delete(win));
  // Cut / Copy / Paste menu for text fields (the renderer handles every other right-click).
  win.webContents.on('context-menu', (e, params) => {
    if (!params.isEditable) return;
    const f = params.editFlags;
    Menu.buildFromTemplate([
      { label: 'Geri al', role: 'undo', enabled: f.canUndo },
      { label: 'Yinele', role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { label: 'Kes', role: 'cut', enabled: f.canCut },
      { label: 'Kopyala', role: 'copy', enabled: f.canCopy },
      { label: 'Yapıştır', role: 'paste', enabled: f.canPaste },
      { label: 'Sil', role: 'delete', enabled: f.canDelete },
      { type: 'separator' },
      { label: 'Tümünü seç', role: 'selectAll' },
    ]).popup({ window: win });
  });
  const saveState = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? settings.get('windowState', {}) : win.getBounds();
    settings.set('windowState', { ...b, maximized });
  };
  win.on('resize', saveState);
  win.on('move', saveState);

  // External links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(APP_URL)) return;
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
  });

  win.loadURL(APP_URL);
  return win;
}

function focusedWindow() {
  return BrowserWindow.getFocusedWindow() || [...windows][0] || null;
}

async function openPathInBestWindow(filePath) {
  const target = focusedWindow();
  if (target) {
    const isEmpty = await target.webContents.executeJavaScript('window.__katipIsEmpty && window.__katipIsEmpty()').catch(() => false);
    if (isEmpty) {
      target.webContents.send('app:open-path', filePath);
      if (target.isMinimized()) target.restore();
      target.focus();
      return;
    }
  }
  createWindow(filePath);
}

function addRecent(filePath) {
  let recent = settings.get('recent', []);
  recent = [filePath, ...recent.filter((p) => p !== filePath)].slice(0, 12);
  settings.set('recent', recent);
  if (process.platform === 'win32') app.addRecentDocument(filePath);
  refreshMenu();
}

function refreshMenu() {
  Menu.setApplicationMenu(buildMenu({
    recent: settings.get('recent', []),
    send: (channel, ...args) => focusedWindow()?.webContents.send(channel, ...args),
    newWindow: () => createWindow(),
    openRecent: (p) => openPathInBestWindow(p),
    clearRecent: () => { settings.set('recent', []); refreshMenu(); },
  }));
}

// ---------- IPC ----------
ipcMain.handle('app:pending-file', (e) => {
  const p = pendingFiles.get(e.sender.id) || null;
  pendingFiles.delete(e.sender.id);
  return p;
});

ipcMain.handle('file:open-dialog', async (e, opts = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: opts.title || 'PDF Aç',
    properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: opts.filters || [{ name: 'PDF Belgeleri', extensions: ['pdf'] }, { name: 'Tüm Dosyalar', extensions: ['*'] }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('file:read', async (e, filePath) => {
  const buf = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  if (filePath.toLowerCase().endsWith('.pdf')) addRecent(filePath);
  return { data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), size: stat.size, mtime: stat.mtimeMs };
});

ipcMain.handle('file:save-dialog', async (e, opts = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showSaveDialog(win, {
    title: opts.title || 'Farklı Kaydet',
    defaultPath: opts.defaultPath,
    filters: opts.filters || [{ name: 'PDF Belgesi', extensions: ['pdf'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('file:choose-dir', async (e, opts = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: opts.title || 'Klasör Seç',
    defaultPath: opts.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('file:write', async (e, filePath, data) => {
  // Write to a temp file first so a failed write never corrupts the original.
  const tmp = `${filePath}.katip-tmp`;
  await fs.writeFile(tmp, Buffer.from(data));
  await fs.rename(tmp, filePath);
  if (filePath.toLowerCase().endsWith('.pdf')) addRecent(filePath);
  return true;
});

ipcMain.handle('file:show-in-folder', (e, filePath) => shell.showItemInFolder(filePath));

ipcMain.handle('pdf:op', async (e, op, args) => pdfops.run(op, args));

ipcMain.handle('app:confirm', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showMessageBox(win, {
    type: opts.type || 'question',
    buttons: opts.buttons || ['Tamam', 'İptal'],
    defaultId: opts.defaultId ?? 0,
    cancelId: opts.cancelId ?? 1,
    title: APP_NAME,
    message: opts.message,
    detail: opts.detail,
    noLink: true,
  });
  return res.response;
});

// Native right-click menu built from a plain description sent by the renderer.
// Resolves with the clicked item's id, or null when the menu is dismissed.
ipcMain.handle('app:context-menu', (e, items) => new Promise((resolve) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let chosen = null;
  const template = (items || []).map((it) => (it.type === 'separator'
    ? { type: 'separator' }
    : {
      label: it.label,
      accelerator: it.accelerator,
      registerAccelerator: false,
      enabled: it.enabled !== false,
      type: it.type === 'checkbox' ? 'checkbox' : 'normal',
      checked: !!it.checked,
      click: () => { chosen = it.id; },
    }));
  Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => resolve(chosen), 0) });
}));

ipcMain.handle('app:print', async (e) => {
  const wc = e.sender;
  return new Promise((resolve) => {
    wc.print({ silent: false, printBackground: true }, (success, reason) => resolve({ success, reason }));
  });
});

ipcMain.handle('app:set-title', (e, title) => {
  BrowserWindow.fromWebContents(e.sender)?.setTitle(title);
});

ipcMain.handle('app:toggle-fullscreen', (e, value) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  win.setFullScreen(typeof value === 'boolean' ? value : !win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('app:new-window', () => { createWindow(); });

ipcMain.handle('app:close-confirmed', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { win.__forceClose = true; win.close(); }
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), name: APP_NAME, platform: process.platform, arch: process.arch }));

ipcMain.handle('settings:get', (e, key, def) => settings.get(key, def));
ipcMain.handle('settings:set', (e, key, value) => settings.set(key, value));

// ---------- App lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const files = pdfArgsFrom(argv);
    if (files.length) files.forEach((f) => openPathInBestWindow(f));
    else {
      const w = focusedWindow();
      if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('katip', (request) => {
      const { pathname } = new URL(request.url);
      const filePath = path.normalize(path.join(APP_ROOT, decodeURIComponent(pathname)));
      if (!SERVED_DIRS.some((d) => filePath.startsWith(d))) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    });
    settings.init(app.getPath('userData'));
    refreshMenu();
    const files = pdfArgsFrom(process.argv);
    if (files.length) files.forEach((f) => createWindow(f));
    else createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
