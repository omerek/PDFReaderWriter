'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('katip', {
  pendingFile: () => ipcRenderer.invoke('app:pending-file'),
  openDialog: (opts) => ipcRenderer.invoke('file:open-dialog', opts),
  saveDialog: (opts) => ipcRenderer.invoke('file:save-dialog', opts),
  chooseDir: (opts) => ipcRenderer.invoke('file:choose-dir', opts),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, data) => ipcRenderer.invoke('file:write', p, data),
  showInFolder: (p) => ipcRenderer.invoke('file:show-in-folder', p),
  pdfOp: (op, args) => ipcRenderer.invoke('pdf:op', op, args),
  confirm: (opts) => ipcRenderer.invoke('app:confirm', opts),
  print: () => ipcRenderer.invoke('app:print'),
  contextMenu: (items) => ipcRenderer.invoke('app:context-menu', items),
  setTitle: (t) => ipcRenderer.invoke('app:set-title', t),
  toggleFullscreen: (v) => ipcRenderer.invoke('app:toggle-fullscreen', v),
  newWindow: () => ipcRenderer.invoke('app:new-window'),
  closeConfirmed: () => ipcRenderer.invoke('app:close-confirmed'),
  info: () => ipcRenderer.invoke('app:info'),
  getSetting: (k, d) => ipcRenderer.invoke('settings:get', k, d),
  setSetting: (k, v) => ipcRenderer.invoke('settings:set', k, v),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, fn) => {
    const allowed = ['cmd', 'app:open-path', 'app:request-close'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
});
