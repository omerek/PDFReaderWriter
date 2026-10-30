// Katip PDF for Android: the same window.katip API the desktop preload offers, implemented with
// Capacitor. Files are Android documents (content:// URIs from the system file picker); they are
// passed around the renderer as "paths" of the form  katip-doc:<encoded uri>/<file name>  so that
// basename() still yields the file name. Folders chosen for split / export are  katip-dir:<encoded uri>.

import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { KatipFilesWeb } from './files-web.js';
import { startMobileUI, actionSheet, confirmSheet } from './mobile-ui.js';

const native = Capacitor.isNativePlatform();
const webFiles = new KatipFilesWeb();
const Files = native ? registerPlugin('KatipFiles') : webFiles;

const DOC = 'katip-doc:';
const DIR = 'katip-dir:';
const CHUNK = 3 * 1024 * 1024;

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
const safeName = (name) => String(name || 'Belge.pdf').replace(/[\\/:*?"<>|]/g, '_');

function docPath(uri, name) {
  return `${DOC}${encodeURIComponent(uri)}/${safeName(name)}`;
}

function parseDoc(p) {
  if (!String(p).startsWith(DOC)) throw new Error(`Geçersiz dosya: ${p}`);
  const rest = p.slice(DOC.length);
  const i = rest.indexOf('/');
  return { uri: decodeURIComponent(rest.slice(0, i)), name: rest.slice(i + 1) };
}

// ------------------------------------------------------------------ bytes <-> base64
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Sends bytes to the native side in chunks; returns the id of the staged temporary file.
async function stage(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  if (!bytes.length) await Files.stageChunk({ id, data: '', append: false });
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await Files.stageChunk({ id, data: toBase64(bytes.subarray(i, i + CHUNK)), append: i > 0 });
  }
  return id;
}

async function readUri(uri) {
  if (!native) return webFiles.bytesOf(uri);
  // Capacitor's local web server streams content:// URIs, which avoids base64 for large files.
  try {
    const res = await fetch(Capacitor.convertFileSrc(uri));
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  } catch {
    // fall back to the plugin below
  }
  const { data } = await Files.readFile({ uri });
  return fromBase64(data);
}

// ------------------------------------------------------------------ settings (localStorage)
const SETTINGS_KEY = 'katip:settings';
let settings = {};
try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { settings = {}; }
// First start on a phone: closed sidebar and pages fitted to the screen width.
if (!settings.prefs && window.innerWidth < 760) settings.prefs = { sidebar: false, defaultZoom: 'page-width' };
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
}

function addRecent(p) {
  settings.recent = [p, ...(settings.recent || []).filter((r) => r !== p)].slice(0, 12);
  saveSettings();
}

// ------------------------------------------------------------------ pdf-lib operations in a worker
const worker = new Worker(new URL('pdfops-worker.js', document.currentScript.src));
const pending = new Map();
let seq = 0;
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error) p.reject(new Error(error)); else p.resolve(result);
};
worker.onerror = (e) => console.error('pdfops worker', e.message);

function pdfOp(op, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

// ------------------------------------------------------------------ events
const listeners = { cmd: [], 'app:open-path': [], 'app:request-close': [], 'mobile:back': [] };
function emit(channel, ...args) {
  (listeners[channel] || []).forEach((fn) => fn(...args));
}

if (native) {
  Files.addListener('openUri', ({ uri, name }) => emit('app:open-path', docPath(uri, name)));
}

function acceptToMime(filters) {
  const exts = (filters || [{ extensions: ['pdf'] }]).flatMap((f) => f.extensions || []);
  if (exts.includes('*')) return ['*/*'];
  return [...new Set(exts.map((e) => MIME[e.toLowerCase()]).filter(Boolean))];
}

// ------------------------------------------------------------------ window.katip
const api = {
  isMobile: true,
  pendingFile: async () => {
    const r = await Files.getPendingIntent().catch(() => ({}));
    return r?.uri ? docPath(r.uri, r.name) : null;
  },
  openDialog: async (opts = {}) => {
    const { files } = await Files.openDocuments({ multi: !!opts.multi, mimeTypes: acceptToMime(opts.filters) });
    return (files || []).map((f) => docPath(f.uri, f.name));
  },
  saveDialog: async (opts = {}) => {
    const name = safeName(String(opts.defaultPath || 'Belge.pdf').split(/[\\/]/).pop());
    const res = await Files.createDocument({ name, mime: mimeOf(name) });
    return res?.uri ? docPath(res.uri, res.name || name) : null;
  },
  chooseDir: async () => {
    const res = await Files.chooseDirectory();
    return res?.uri ? `${DIR}${encodeURIComponent(res.uri)}` : null;
  },
  readFile: async (p) => {
    const { uri, name } = parseDoc(p);
    const data = await readUri(uri);
    if (/\.pdf$/i.test(name)) addRecent(p);
    return { data, size: data.length, mtime: Date.now() };
  },
  writeFile: async (p, data) => {
    const id = await stage(data);
    if (p.startsWith(DIR)) {
      const rest = p.slice(DIR.length);
      const i = rest.indexOf('/');
      const name = rest.slice(i + 1);
      await Files.commitToDirectory({ id, treeUri: decodeURIComponent(rest.slice(0, i)), name, mime: mimeOf(name) });
      return true;
    }
    const { uri, name } = parseDoc(p);
    await Files.commit({ id, uri });
    if (/\.pdf$/i.test(name)) addRecent(p);
    return true;
  },
  showInFolder: () => {},
  pdfOp,
  confirm: (opts) => confirmSheet(opts),
  print: () => {
    window.print();
    return { success: true };
  },
  // Android extras (used by app.js when present).
  printPdf: async (bytes, name) => Files.print({ id: await stage(bytes), name: safeName(name) }),
  share: async (bytes, name) => Files.share({ id: await stage(bytes), name: safeName(name), mime: mimeOf(name) }),
  contextMenu: (items) => actionSheet(items),
  setTitle: () => {},
  toggleFullscreen: async (v) => {
    try {
      if (v) await SystemBars.hide(); else await SystemBars.show();
    } catch {
      // not available in the browser preview
    }
    return !!v;
  },
  newWindow: () => {},
  closeConfirmed: () => App.exitApp().catch(() => {}),
  info: async () => {
    const info = await App.getInfo().catch(() => null);
    return { version: info?.version || '', name: 'Katip PDF', platform: 'android', arch: '' };
  },
  getSetting: async (k, d) => (k in settings ? settings[k] : d),
  setSetting: async (k, v) => {
    settings[k] = v;
    saveSettings();
    return true;
  },
  pathForFile: () => '',
  on: (channel, fn) => {
    if (listeners[channel]) listeners[channel].push(fn);
  },
  // Used by the mobile UI.
  emit,
  setBarsColor: async (color, dark) => {
    if (!native) return;
    try {
      await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
      await Files.setBackground({ color });
    } catch {
      // cosmetic only
    }
  },
};

window.katip = api;
// Expose the browser stand-in so automated tests can feed files to the picker.
if (!native) window.__katipWebFiles = webFiles;

App.addListener('backButton', () => emit('mobile:back')).catch(() => {});
startMobileUI(api);
