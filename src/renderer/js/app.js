// Katip PDF - renderer entry point.
// Viewing is done with pdf.js (PDFViewer component), annotation editing with pdf.js' built-in
// editors, and structural changes (pages, merge, split, notes) with pdf-lib in the main process.

import { $, $$, el, toast, busy, prompt, alertDialog, basename } from './ui.js';
import { initSidebar } from './sidebar.js';
import { initOrganizer } from './organizer.js';
import { openSignatureDialog } from './signature.js';
import * as dialogs from './dialogs.js';

const PDFJS = new URL('../../../node_modules/pdfjs-dist/', import.meta.url).href;
const pdfjsLib = await import(`${PDFJS}build/pdf.mjs`);
globalThis.pdfjsLib = pdfjsLib;
const viewerLib = await import(`${PDFJS}web/pdf_viewer.mjs`);
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}build/pdf.worker.mjs`;

const { AnnotationEditorType: ET, AnnotationEditorParamsType: PT, AnnotationMode } = pdfjsLib;
const { EventBus, PDFLinkService, PDFFindController, PDFViewer, PDFScriptingManager, LinkTarget, ScrollMode, SpreadMode } = viewerLib;

const api = window.katip;
const MAX_HISTORY = 20;

const DOC_OPTIONS = {
  cMapUrl: `${PDFJS}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS}standard_fonts/`,
  wasmUrl: `${PDFJS}wasm/`,
  iccUrl: `${PDFJS}iccs/`,
  isEvalSupported: false,
  enableXfa: true,
};

const COLORS = {
  ink: ['#000000', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff'],
  highlight: ['#FFFF98', '#53FFBC', '#80EBFF', '#FFCBE6', '#FF4F5F'],
};

const TOOL_DEFS = {
  select: { mode: ET.NONE, title: 'Metin Seçimi' },
  hand: { mode: ET.NONE, title: 'El Aracı' },
  highlight: {
    mode: ET.HIGHLIGHT, title: 'Vurgula', fields: ['color', 'thickness'], palette: 'highlight',
    hint: 'Vurgulamak için metni seçin; boş alanda sürükleyerek serbest vurgulama yapabilirsiniz.',
  },
  text: {
    mode: ET.FREETEXT, title: 'Metin Ekle', fields: ['color', 'fontsize'], palette: 'ink',
    hint: 'Sayfada metin eklemek istediğiniz yere tıklayın.',
  },
  draw: {
    mode: ET.INK, title: 'Serbest Çizim', fields: ['color', 'thickness', 'opacity'], palette: 'ink',
    hint: 'Sayfa üzerinde fareyle çizin. Seçip Delete ile silebilirsiniz.',
  },
  note: {
    mode: ET.NONE, title: 'Yapışkan Not', fields: ['color'], palette: 'highlight',
    hint: 'Notun ekleneceği yere tıklayın. Esc ile iptal.',
  },
  image: {
    mode: ET.STAMP, title: 'Resim / İmza', fields: [],
    hint: 'Resmi sürükleyerek taşıyın, köşelerinden boyutlandırın. Delete ile silin.',
  },
};

// ---------------------------------------------------------------- state
const state = {
  pdfDoc: null,
  filePath: null,
  fileName: null,
  fileSize: 0,
  dirty: false,
  password: null,
  tool: 'select',
  undo: [],
  redo: [],
  editorCanUndo: false,
  editorCanRedo: false,
  pendingView: null,
  prefs: {
    theme: 'system',
    defaultZoom: 'auto',
    author: '',
    sidebar: true,
    toolSettings: {
      highlight: { color: '#FFFF98', thickness: 12 },
      text: { color: '#000000', fontsize: 14 },
      draw: { color: '#e11d48', thickness: 3, opacity: 100 },
      note: { color: '#FFFF98' },
    },
  },
};

// ---------------------------------------------------------------- viewer setup
const container = $('#viewerContainer');
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
const findController = new PDFFindController({ eventBus, linkService });
let scriptingManager = null;
try {
  scriptingManager = new PDFScriptingManager({ eventBus, sandboxBundleSrc: `${PDFJS}build/pdf.sandbox.mjs`, wasmUrl: `${PDFJS}wasm/` });
} catch {
  scriptingManager = null;
}
const pdfViewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  findController,
  scriptingManager,
  annotationEditorMode: ET.NONE,
  annotationEditorHighlightColors: 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F',
  imageResourcesPath: `${PDFJS}web/images/`,
  maxCanvasPixels: 2 ** 25,
  enableHWA: true,
});
linkService.setViewer(pdfViewer);
scriptingManager?.setViewer(pdfViewer);

// Shared context handed to the feature modules.
const ctx = {
  api, state, pdfjsLib, pdfViewer, eventBus, linkService,
  getCurrentBytes, applyOp, loadBytes, openPath, setDirty, saveBytesAs, goToPage,
  renderPageToCanvas, docBaseName, refreshAfterLoad: () => {},
};

const sidebar = initSidebar(ctx);
const organizer = initOrganizer(ctx);

// ---------------------------------------------------------------- loading
async function openPath(filePath) {
  if (!(await confirmDiscard())) return;
  try {
    const { data, size } = await busy('Açılıyor…', () => api.readFile(filePath));
    state.password = null;
    await loadBytes(data, { filePath, fileSize: size, fresh: true });
  } catch (err) {
    toast(`Dosya açılamadı: ${err.message || err}`, { error: true });
  }
}

/**
 * Load PDF bytes into the viewer.
 * fresh: a newly opened document (resets history); otherwise the view position is kept.
 */
async function loadBytes(data, { filePath, fileName, fileSize, fresh = false, untitled = false } = {}) {
  const task = pdfjsLib.getDocument({ ...DOC_OPTIONS, data: data.slice(), password: state.password || undefined });
  task.onPassword = async (update, reason) => {
    const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    const pw = await prompt({
      title: 'Parola korumalı belge',
      label: wrong ? 'Parola yanlış. Tekrar deneyin:' : 'Bu belgeyi açmak için parolayı girin:',
      type: 'password',
      okLabel: 'Aç',
    });
    if (pw === null) {
      task.destroy();
      return;
    }
    state.password = pw;
    update(pw);
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'AbortException' || /destroyed/i.test(err?.message)) return;
    const msg = err?.name === 'InvalidPDFException' ? 'Bu dosya geçerli bir PDF değil veya bozuk.' : (err.message || String(err));
    throw new Error(msg);
  }

  if (!fresh && state.pdfDoc) {
    state.pendingView = {
      page: pdfViewer.currentPageNumber,
      scale: pdfViewer.currentScaleValue,
      top: container.scrollTop,
      left: container.scrollLeft,
    };
  } else {
    state.pendingView = null;
  }

  const old = state.pdfDoc;
  state.pdfDoc = doc;
  if (fresh) {
    state.filePath = filePath || null;
    state.fileName = fileName || (filePath ? basename(filePath) : 'Adsız.pdf');
    state.fileSize = fileSize || data.length;
    state.undo = [];
    state.redo = [];
    state.dirty = !!untitled;
  }
  state.fileSize = data.length;

  doc.annotationStorage.onSetModified = () => setDirty(true);
  // The editor undo stack belongs to the previous document instance.
  state.editorCanUndo = false;
  state.editorCanRedo = false;

  pdfViewer.setDocument(doc);
  linkService.setDocument(doc, null);
  if (old) old.loadingTask.destroy().catch(() => {});

  document.body.classList.remove('no-doc');
  updateTitle();
  updateUndoButtons();
  sidebar.onDocument(doc);
  $('#pageCount').textContent = `/ ${doc.numPages}`;
  if (state.tool !== 'select' && state.tool !== 'hand') setTool('select');
}

eventBus.on('pagesinit', () => {
  const v = state.pendingView;
  if (v) {
    pdfViewer.currentScaleValue = v.scale;
    pdfViewer.currentPageNumber = Math.min(v.page, pdfViewer.pagesCount);
    requestAnimationFrame(() => {
      container.scrollTop = v.top;
      container.scrollLeft = v.left;
    });
  } else {
    pdfViewer.currentScaleValue = state.prefs.defaultZoom || 'auto';
  }
  state.pendingView = null;
  updateStatus();
});

eventBus.on('pagechanging', ({ pageNumber }) => {
  $('#pageInput').value = pageNumber;
  sidebar.setCurrentPage(pageNumber);
  updateStatus();
});

eventBus.on('scalechanging', ({ scale, presetValue }) => {
  const sel = $('#zoomSelect');
  const custom = $('#zoomCustom');
  const preset = presetValue && [...sel.options].find((o) => o.value === String(presetValue));
  const exact = [...sel.options].find((o) => !o.hidden && Number(o.value) && Math.abs(Number(o.value) - scale) < 0.001);
  if (preset && !Number(presetValue)) {
    sel.value = preset.value;
  } else if (exact) {
    sel.value = exact.value;
  } else {
    custom.hidden = false;
    custom.textContent = `%${Math.round(scale * 100)}`;
    sel.value = 'custom';
  }
  updateStatus();
});

eventBus.on('editingstateschanged', ({ details }) => {
  state.editorCanUndo = !!details.hasSomethingToUndo;
  state.editorCanRedo = !!details.hasSomethingToRedo;
  updateUndoButtons();
});

eventBus.on('annotationeditormodechanged', ({ mode }) => {
  // pdf.js may leave editing mode by itself (e.g. Escape); keep our toolbar in sync.
  const def = TOOL_DEFS[state.tool];
  if (def && def.mode !== mode && mode === ET.NONE && state.tool !== 'note') {
    setTool('select', { skipMode: true });
  }
});

// ---------------------------------------------------------------- bytes / history
async function commitEditors() {
  // Leave any in-progress text editing so its content is serialized.
  const active = document.activeElement;
  if (active && active.closest?.('.annotationEditorLayer')) active.blur();
}

async function getCurrentBytes() {
  const doc = state.pdfDoc;
  if (!doc) throw new Error('Açık belge yok.');
  await commitEditors();
  if (doc.annotationStorage.size === 0) return doc.getData();
  const bytes = await doc.saveDocument();
  // Give Turkish text in new text boxes / form fields an embedded font (see pdfops.fixAppearances).
  return api.pdfOp('fixAppearances', { bytes });
}

function pushHistory(bytes, label) {
  state.undo.push({ bytes, label });
  if (state.undo.length > MAX_HISTORY) state.undo.shift();
  state.redo = [];
  updateUndoButtons();
}

async function applyOp(label, op, args = {}, { busyText } = {}) {
  if (!state.pdfDoc) return null;
  try {
    return await busy(busyText || `${label}…`, async () => {
      const before = await getCurrentBytes();
      const after = await api.pdfOp(op, { bytes: before, ...args });
      pushHistory(before, label);
      await loadBytes(after);
      setDirty(true);
      return after;
    });
  } catch (err) {
    toast(cleanError(err), { error: true });
    return null;
  }
}

async function undo() {
  if (state.editorCanUndo) {
    eventBus.dispatch('editingaction', { source: null, name: 'undo' });
    return;
  }
  const entry = state.undo.pop();
  if (!entry) return;
  const current = await getCurrentBytes();
  state.redo.push({ bytes: current, label: entry.label });
  await loadBytes(entry.bytes);
  setDirty(true);
  toast(`Geri alındı: ${entry.label}`);
  updateUndoButtons();
}

async function redo() {
  if (state.editorCanRedo) {
    eventBus.dispatch('editingaction', { source: null, name: 'redo' });
    return;
  }
  const entry = state.redo.pop();
  if (!entry) return;
  const current = await getCurrentBytes();
  state.undo.push({ bytes: current, label: entry.label });
  await loadBytes(entry.bytes);
  setDirty(true);
  toast(`Yinelendi: ${entry.label}`);
  updateUndoButtons();
}

function updateUndoButtons() {
  $('#btnUndo').disabled = !(state.editorCanUndo || state.undo.length);
  $('#btnRedo').disabled = !(state.editorCanRedo || state.redo.length);
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------------------------------------------------------------- save / close
function setDirty(v) {
  if (state.dirty === v) return;
  state.dirty = v;
  updateTitle();
}

function docBaseName() {
  return (state.fileName || 'Belge.pdf').replace(/\.pdf$/i, '');
}

function updateTitle() {
  const name = state.pdfDoc ? `${state.dirty ? '• ' : ''}${state.fileName} - Katip PDF` : 'Katip PDF';
  document.title = name;
  api.setTitle(name);
  $('#statusFile').textContent = state.pdfDoc ? (state.filePath || state.fileName) : '';
}

async function save({ saveAs = false } = {}) {
  if (!state.pdfDoc) return false;
  let target = state.filePath;
  if (saveAs || !target) {
    target = await api.saveDialog({ defaultPath: state.filePath || `${docBaseName()}.pdf` });
    if (!target) return false;
    if (!/\.pdf$/i.test(target)) target += '.pdf';
  }
  try {
    await busy('Kaydediliyor…', async () => {
      const bytes = await getCurrentBytes();
      await api.writeFile(target, bytes);
      state.filePath = target;
      state.fileName = basename(target);
      state.fileSize = bytes.length;
      // Reload so saved annotations become part of the document and editors are reset.
      if (state.pdfDoc.annotationStorage.size > 0) await loadBytes(bytes);
    });
    setDirty(false);
    updateTitle();
    toast('Kaydedildi');
    return true;
  } catch (err) {
    toast(`Kaydedilemedi: ${cleanError(err)}`, { error: true });
    return false;
  }
}

async function saveBytesAs(bytes, defaultName) {
  let target = await api.saveDialog({ defaultPath: defaultName });
  if (!target) return null;
  if (!/\.pdf$/i.test(target)) target += '.pdf';
  await api.writeFile(target, bytes);
  return target;
}

// Returns true when it is OK to discard the current document.
async function confirmDiscard() {
  if (!state.pdfDoc || !state.dirty) return true;
  const r = await api.confirm({
    type: 'warning',
    message: `"${state.fileName}" belgesindeki değişiklikler kaydedilsin mi?`,
    detail: 'Kaydetmezseniz değişiklikleriniz kaybolur.',
    buttons: ['Kaydet', 'Kaydetme', 'İptal'],
    defaultId: 0,
    cancelId: 2,
  });
  if (r === 2) return false;
  if (r === 0) return save();
  return true;
}

async function closeDocument() {
  if (!(await confirmDiscard())) return;
  const old = state.pdfDoc;
  state.pdfDoc = null;
  state.filePath = null;
  state.fileName = null;
  state.dirty = false;
  state.undo = [];
  state.redo = [];
  pdfViewer.setDocument(null);
  linkService.setDocument(null, null);
  old?.loadingTask.destroy().catch(() => {});
  sidebar.onDocument(null);
  document.body.classList.add('no-doc');
  $('#toolOptions').hidden = true;
  updateTitle();
  renderRecent();
}

api.on('app:request-close', async () => {
  if (await confirmDiscard()) api.closeConfirmed();
});

// ---------------------------------------------------------------- navigation / zoom
function goToPage(n) {
  if (!state.pdfDoc) return;
  pdfViewer.currentPageNumber = Math.max(1, Math.min(n, pdfViewer.pagesCount));
}

function zoomBy(factor) {
  const next = Math.max(0.1, Math.min(10, pdfViewer.currentScale * factor));
  pdfViewer.currentScaleValue = String(Math.round(next * 100) / 100);
}

function updateStatus() {
  if (!state.pdfDoc) { $('#statusInfo').textContent = ''; return; }
  const view = pdfViewer.getPageView(pdfViewer.currentPageNumber - 1);
  let size = '';
  if (view?.pdfPage) {
    const [x0, y0, x1, y1] = view.pdfPage.view;
    const w = ((x1 - x0) / 72) * 25.4;
    const h = ((y1 - y0) / 72) * 25.4;
    size = `${Math.round(w)} × ${Math.round(h)} mm`;
  }
  $('#statusInfo').textContent = `Sayfa ${pdfViewer.currentPageNumber} / ${pdfViewer.pagesCount}   ·   ${size}   ·   %${Math.round(pdfViewer.currentScale * 100)}`;
}

$('#pageInput').addEventListener('change', (e) => {
  const n = parseInt(e.target.value, 10);
  if (Number.isFinite(n)) goToPage(n);
  else e.target.value = pdfViewer.currentPageNumber;
});
$('#pageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

$('#zoomSelect').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v !== 'custom') pdfViewer.currentScaleValue = v;
  container.focus();
});

container.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !state.pdfDoc) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

// Hand tool: drag to scroll.
let drag = null;
container.addEventListener('mousedown', (e) => {
  if (state.tool !== 'hand' || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, top: container.scrollTop, left: container.scrollLeft };
  container.classList.add('grabbing');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  container.scrollTop = drag.top - (e.clientY - drag.y);
  container.scrollLeft = drag.left - (e.clientX - drag.x);
});
window.addEventListener('mouseup', () => {
  drag = null;
  container.classList.remove('grabbing');
});

// ---------------------------------------------------------------- tools
function setTool(tool, { skipMode = false } = {}) {
  if (!state.pdfDoc && tool !== 'select') return;
  const def = TOOL_DEFS[tool];
  if (!def) return;
  cancelPlacement();
  state.tool = tool;
  $$('#toolGroup .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  container.classList.toggle('hand', tool === 'hand');

  if (!skipMode && state.pdfDoc) {
    try {
      pdfViewer.annotationEditorMode = { mode: def.mode };
    } catch (err) {
      console.warn(err);
    }
  }
  renderToolOptions();
  if (tool === 'note') startNotePlacement();
  // Apply this tool's stored settings once pdf.js has switched modes.
  setTimeout(applyToolParams, 0);
}

function renderToolOptions() {
  const def = TOOL_DEFS[state.tool];
  const bar = $('#toolOptions');
  if (!def.fields && !def.hint) { bar.hidden = true; return; }
  bar.hidden = !state.pdfDoc;
  $('#toolOptionsTitle').textContent = def.title;
  $('#toolHint').textContent = def.hint || '';
  const fields = def.fields || [];
  $$('#toolOptions .to-field').forEach((f) => { f.hidden = !fields.includes(f.dataset.for); });
  const s = state.prefs.toolSettings[state.tool] || {};

  if (fields.includes('color')) {
    const sw = $('#swatches');
    sw.replaceChildren();
    const palette = COLORS[def.palette || 'ink'];
    for (const c of palette) {
      const b = el('button', { class: `swatch${c.toLowerCase() === String(s.color).toLowerCase() ? ' active' : ''}`, title: c, style: { background: c } });
      b.addEventListener('click', () => updateToolSetting('color', c));
      sw.append(b);
    }
    const custom = el('label', { class: 'swatch custom', title: 'Özel renk' });
    const input = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#000000' });
    input.addEventListener('input', () => updateToolSetting('color', input.value));
    custom.append(input);
    sw.append(custom);
  }
  if (fields.includes('thickness')) {
    const r = $('#optThickness');
    r.max = state.tool === 'highlight' ? 24 : 20;
    r.min = state.tool === 'highlight' ? 8 : 1;
    r.value = s.thickness;
    $('#optThicknessOut').textContent = s.thickness;
  }
  if (fields.includes('opacity')) {
    $('#optOpacity').value = s.opacity;
    $('#optOpacityOut').textContent = `%${s.opacity}`;
  }
  if (fields.includes('fontsize')) $('#optFontSize').value = s.fontsize;
}

function updateToolSetting(key, value) {
  const s = state.prefs.toolSettings[state.tool];
  if (!s) return;
  s[key] = value;
  api.setSetting('prefs', state.prefs);
  renderToolOptions();
  applyToolParams();
}

function applyToolParams() {
  const s = state.prefs.toolSettings[state.tool];
  if (!s || !state.pdfDoc) return;
  const send = (type, value) => eventBus.dispatch('switchannotationeditorparams', { source: null, type, value });
  switch (state.tool) {
    case 'highlight':
      send(PT.HIGHLIGHT_COLOR, s.color);
      send(PT.HIGHLIGHT_THICKNESS, Number(s.thickness));
      break;
    case 'text':
      send(PT.FREETEXT_COLOR, s.color);
      send(PT.FREETEXT_SIZE, Number(s.fontsize));
      break;
    case 'draw':
      send(PT.INK_COLOR, s.color);
      send(PT.INK_THICKNESS, Number(s.thickness));
      send(PT.INK_OPACITY, Number(s.opacity) / 100);
      break;
    default:
      break;
  }
}

$('#optThickness').addEventListener('input', (e) => {
  $('#optThicknessOut').textContent = e.target.value;
  updateToolSetting('thickness', Number(e.target.value));
});
$('#optOpacity').addEventListener('input', (e) => {
  $('#optOpacityOut').textContent = `%${e.target.value}`;
  updateToolSetting('opacity', Number(e.target.value));
});
$('#optFontSize').addEventListener('change', (e) => updateToolSetting('fontsize', Number(e.target.value) || 14));

// ----- placement (sticky notes): click on a page to choose a position.
let placement = null;

function pagePointFromEvent(e) {
  const pageEl = e.target.closest?.('.page');
  if (!pageEl) return null;
  const pageNumber = Number(pageEl.dataset.pageNumber);
  const view = pdfViewer.getPageView(pageNumber - 1);
  if (!view) return null;
  const rect = pageEl.getBoundingClientRect();
  const style = getComputedStyle(pageEl);
  const bl = parseFloat(style.borderLeftWidth) || 0;
  const bt = parseFloat(style.borderTopWidth) || 0;
  const [x, y] = view.viewport.convertToPdfPoint(e.clientX - rect.left - bl, e.clientY - rect.top - bt);
  return { pageIndex: pageNumber - 1, x, y };
}

function startNotePlacement() {
  container.classList.add('placing');
  placement = async (e) => {
    const pt = pagePointFromEvent(e);
    if (!pt) return;
    e.preventDefault();
    e.stopPropagation();
    const text = await prompt({ title: 'Yapışkan not', label: 'Not metni:', multiline: true, okLabel: 'Ekle' });
    if (text === null) return;
    const hex = state.prefs.toolSettings.note.color;
    const color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    await applyOp('Not ekleme', 'addNote', {
      page: pt.pageIndex, x: pt.x, y: pt.y, text, color, author: state.prefs.author || '',
    });
    setTool('note');
  };
  container.addEventListener('click', placement, true);
}

function cancelPlacement() {
  if (placement) container.removeEventListener('click', placement, true);
  placement = null;
  container.classList.remove('placing');
}

// ----- images & signatures (pdf.js stamp editor)
async function insertImageFile(file) {
  if (!state.pdfDoc) return;
  setTool('image');
  await new Promise((r) => setTimeout(r, 60));
  eventBus.dispatch('switchannotationeditorparams', { source: null, type: PT.CREATE, value: { bitmapFile: file } });
  setDirty(true);
}

async function pickImage() {
  const [p] = await api.openDialog({
    title: 'Resim seç',
    filters: [{ name: 'Resimler', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
  });
  if (!p) return;
  const { data } = await api.readFile(p);
  const ext = p.split('.').pop().toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[ext] || `image/${ext}`;
  await insertImageFile(new File([data], basename(p), { type }));
}

async function signDocument() {
  if (!state.pdfDoc) return;
  const blob = await openSignatureDialog(ctx);
  if (!blob) return;
  await insertImageFile(new File([blob], 'imza.png', { type: 'image/png' }));
  toast('İmza eklendi. Sürükleyerek yerleştirin, köşelerden boyutlandırın.');
}

// ---------------------------------------------------------------- find bar
const findbar = $('#findbar');
const findInput = $('#findInput');

function openFind() {
  if (!state.pdfDoc) return;
  findbar.hidden = false;
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length < 80) findInput.value = sel;
  findInput.focus();
  findInput.select();
  if (findInput.value) dispatchFind('');
}

function closeFind() {
  findbar.hidden = true;
  eventBus.dispatch('findbarclose', { source: null });
  container.focus();
}

function dispatchFind(type, findPrevious = false) {
  eventBus.dispatch('find', {
    source: null,
    type,
    query: findInput.value,
    caseSensitive: $('#findCase').checked,
    entireWord: $('#findWord').checked,
    highlightAll: $('#findAll').checked,
    findPrevious,
    matchDiacritics: false,
  });
}

findInput.addEventListener('input', () => dispatchFind(''));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); dispatchFind('again', e.shiftKey); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#findNext').addEventListener('click', () => dispatchFind('again', false));
$('#findPrev').addEventListener('click', () => dispatchFind('again', true));
$('#findClose').addEventListener('click', closeFind);
$('#findCase').addEventListener('change', () => dispatchFind('casesensitivitychange'));
$('#findWord').addEventListener('change', () => dispatchFind('entirewordchange'));
$('#findAll').addEventListener('change', () => dispatchFind('highlightallchange'));

function showFindCount(matchesCount, stateCode) {
  const res = $('#findResult');
  const total = matchesCount?.total ?? 0;
  const current = matchesCount?.current ?? 0;
  const notFound = stateCode === 1 || (findInput.value && total === 0 && stateCode !== 3);
  findInput.classList.toggle('notfound', !!(findInput.value && notFound));
  if (!findInput.value) res.textContent = '';
  else if (total) res.textContent = `${current} / ${total}`;
  else if (stateCode === 3) res.textContent = '…';
  else res.textContent = 'Bulunamadı';
}
eventBus.on('updatefindmatchescount', ({ matchesCount }) => showFindCount(matchesCount));
eventBus.on('updatefindcontrolstate', ({ state: s, matchesCount }) => showFindCount(matchesCount, s));

// ---------------------------------------------------------------- printing & rendering helpers
async function renderPageToCanvas(pageIndex, { scale = 1, maxWidth, maxHeight, print = false, doc = state.pdfDoc } = {}) {
  const page = await doc.getPage(pageIndex + 1);
  let viewport = page.getViewport({ scale: 1 });
  let s = scale;
  if (maxWidth || maxHeight) {
    s = Math.min(maxWidth ? maxWidth / viewport.width : Infinity, maxHeight ? maxHeight / viewport.height : Infinity);
  }
  viewport = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    intent: print ? 'print' : 'display',
    annotationMode: AnnotationMode.ENABLE_STORAGE,
  }).promise;
  return canvas;
}

async function printDocument() {
  if (!state.pdfDoc) return;
  const doc = state.pdfDoc;
  const pc = $('#printContainer');
  pc.replaceChildren();
  const urls = [];
  try {
    await busy('Yazdırma hazırlanıyor…', async () => {
      await commitEditors();
      for (let i = 0; i < doc.numPages; i++) {
        $('#busyText').textContent = `Yazdırma hazırlanıyor… ${i + 1}/${doc.numPages}`;
        const canvas = await renderPageToCanvas(i, { scale: 150 / 72, print: true });
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = el('img', { src: url });
        pc.append(el('div', { class: 'print-page' }, img));
        await img.decode().catch(() => {});
      }
    });
    await api.print();
  } catch (err) {
    toast(`Yazdırılamadı: ${cleanError(err)}`, { error: true });
  } finally {
    pc.replaceChildren();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

// ---------------------------------------------------------------- view modes
function setLayout(kind) {
  const map = {
    single: [ScrollMode.PAGE, SpreadMode.NONE],
    continuous: [ScrollMode.VERTICAL, SpreadMode.NONE],
    two: [ScrollMode.VERTICAL, SpreadMode.ODD],
    twoCover: [ScrollMode.VERTICAL, SpreadMode.EVEN],
    horizontal: [ScrollMode.HORIZONTAL, SpreadMode.NONE],
  };
  const [scroll, spread] = map[kind];
  pdfViewer.scrollMode = scroll;
  pdfViewer.spreadMode = spread;
}

let presentationSaved = null;
async function togglePresentation(force) {
  const on = typeof force === 'boolean' ? force : !document.body.classList.contains('presentation');
  if (on) {
    if (!state.pdfDoc) return;
    presentationSaved = { scale: pdfViewer.currentScaleValue, scroll: pdfViewer.scrollMode, spread: pdfViewer.spreadMode };
    document.body.classList.add('presentation');
    await api.toggleFullscreen(true);
    pdfViewer.scrollMode = ScrollMode.PAGE;
    pdfViewer.spreadMode = SpreadMode.NONE;
    setTimeout(() => { pdfViewer.currentScaleValue = 'page-fit'; }, 150);
  } else {
    document.body.classList.remove('presentation');
    await api.toggleFullscreen(false);
    if (presentationSaved) {
      pdfViewer.scrollMode = presentationSaved.scroll;
      pdfViewer.spreadMode = presentationSaved.spread;
      setTimeout(() => { pdfViewer.currentScaleValue = presentationSaved.scale; }, 150);
    }
  }
}

function applyTheme() {
  const t = state.prefs.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------------------------------------------------------------- commands
const commands = {
  open: async () => {
    const [p] = await api.openDialog({});
    if (p) await openPath(p);
  },
  save: () => save(),
  saveAs: () => save({ saveAs: true }),
  close: () => closeDocument(),
  print: () => printDocument(),
  properties: () => state.pdfDoc && dialogs.properties(ctx),
  preferences: async () => {
    const res = await dialogs.preferences(ctx);
    if (res) {
      Object.assign(state.prefs, res);
      api.setSetting('prefs', state.prefs);
      applyTheme();
    }
  },
  merge: () => dialogs.merge(ctx),
  split: () => state.pdfDoc && dialogs.split(ctx),
  imagesToPdf: () => dialogs.imagesToPdf(ctx),
  exportImages: () => state.pdfDoc && dialogs.exportImages(ctx),
  undo: () => undo(),
  redo: () => redo(),
  find: () => openFind(),
  findNext: () => { if (findbar.hidden) openFind(); else dispatchFind('again', false); },
  findPrev: () => { if (findbar.hidden) openFind(); else dispatchFind('again', true); },
  zoomIn: () => state.pdfDoc && zoomBy(1.2),
  zoomOut: () => state.pdfDoc && zoomBy(1 / 1.2),
  actualSize: () => { if (state.pdfDoc) pdfViewer.currentScaleValue = 'page-actual'; },
  fitPage: () => { if (state.pdfDoc) pdfViewer.currentScaleValue = 'page-fit'; },
  fitWidth: () => { if (state.pdfDoc) pdfViewer.currentScaleValue = 'page-width'; },
  rotateViewCw: () => { if (state.pdfDoc) pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360; },
  rotateViewCcw: () => { if (state.pdfDoc) pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 270) % 360; },
  layoutSingle: () => setLayout('single'),
  layoutContinuous: () => setLayout('continuous'),
  layoutTwo: () => setLayout('two'),
  layoutTwoCover: () => setLayout('twoCover'),
  layoutHorizontal: () => setLayout('horizontal'),
  toggleSidebar: () => {
    const hidden = $('#sidebar').classList.toggle('hidden');
    state.prefs.sidebar = !hidden;
    api.setSetting('prefs', state.prefs);
  },
  presentation: () => togglePresentation(),
  toggleTheme: () => {
    state.prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    api.setSetting('prefs', state.prefs);
    applyTheme();
  },
  nightMode: () => document.body.classList.toggle('night'),
  prevPage: () => state.pdfDoc && pdfViewer.previousPage(),
  nextPage: () => state.pdfDoc && pdfViewer.nextPage(),
  firstPage: () => goToPage(1),
  lastPage: () => state.pdfDoc && goToPage(pdfViewer.pagesCount),
  gotoPage: async () => {
    if (!state.pdfDoc) return;
    const v = await prompt({ title: 'Sayfaya git', label: `Sayfa numarası (1-${pdfViewer.pagesCount}):`, value: String(pdfViewer.currentPageNumber) });
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) goToPage(n);
  },
  toolSelect: () => setTool('select'),
  toolHand: () => setTool('hand'),
  toolHighlight: () => setTool('highlight'),
  toolText: () => setTool('text'),
  toolDraw: () => setTool('draw'),
  toolNote: () => setTool('note'),
  toolImage: () => pickImage(),
  toolSign: () => signDocument(),
  organize: () => state.pdfDoc && organizer.open(),
  rotatePagesCw: () => applyOp('Sayfa döndürme', 'rotate', { pages: [pdfViewer.currentPageNumber - 1], delta: 90 }),
  rotatePagesCcw: () => applyOp('Sayfa döndürme', 'rotate', { pages: [pdfViewer.currentPageNumber - 1], delta: -90 }),
  deletePage: () => applyOp('Sayfa silme', 'remove', { pages: [pdfViewer.currentPageNumber - 1] }),
  insertBlank: () => applyOp('Boş sayfa ekleme', 'insertBlank', { at: pdfViewer.currentPageNumber }),
  insertFile: () => organizer.insertFromFile(pdfViewer.currentPageNumber),
  extractPages: () => state.pdfDoc && dialogs.extract(ctx),
  flattenForm: () => applyOp('Form düzleştirme', 'flattenForm'),
  shortcuts: () => dialogs.shortcuts(),
  about: () => dialogs.about(ctx),
};

async function runCommand(name) {
  const fn = commands[name];
  if (!fn) return;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(cleanError(err), { error: true });
  }
}
ctx.runCommand = runCommand;

api.on('cmd', runCommand);
api.on('app:open-path', (p) => openPath(p));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) runCommand(b.dataset.cmd);
  const t = e.target.closest('[data-tool]');
  if (t) setTool(t.dataset.tool);
});

// Single-key tool shortcuts and navigation keys that the menu does not own.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
  if ($('#dialog').open || !$('#organizer').hidden) return;
  if (e.key === 'Escape') {
    if (document.body.classList.contains('presentation')) { togglePresentation(false); return; }
    if (!findbar.hidden && !typing) { closeFind(); return; }
    if (state.tool === 'note') { setTool('select'); return; }
  }
  if (typing || e.ctrlKey || e.altKey || e.metaKey || !state.pdfDoc) return;
  if (document.body.classList.contains('presentation')) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); pdfViewer.nextPage(); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); pdfViewer.previousPage(); return; }
  }
  // Let pdf.js editors handle keys while an annotation is selected.
  if (document.activeElement?.closest?.('.annotationEditorLayer')) return;
  const map = { v: 'select', h: 'hand', u: 'highlight', t: 'text', d: 'draw', n: 'note' };
  const tool = map[e.key.toLowerCase()];
  if (tool && !e.shiftKey) { e.preventDefault(); setTool(tool); return; }
  if (e.key === 'Home') { e.preventDefault(); goToPage(1); }
  if (e.key === 'End') { e.preventDefault(); goToPage(pdfViewer.pagesCount); }
  if (pdfViewer.scrollMode === ScrollMode.PAGE || pdfViewer.isInPresentationMode) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); pdfViewer.nextPage(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); pdfViewer.previousPage(); }
  }
});

// ---------------------------------------------------------------- drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  $('#dropHint').hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#dropHint').hidden = true;
});
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  dragDepth = 0;
  $('#dropHint').hidden = true;
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  const images = files.filter((f) => /^image\//.test(f.type));
  if (pdfs.length) {
    await openPath(api.pathForFile(pdfs[0]));
  } else if (images.length && state.pdfDoc) {
    await insertImageFile(images[0]);
  }
});

// ---------------------------------------------------------------- welcome / recent
async function renderRecent() {
  const list = $('#recentList');
  const recent = await api.getSetting('recent', []);
  list.replaceChildren();
  if (!recent.length) return;
  list.append(el('h3', {}, 'Son kullanılan dosyalar'));
  for (const p of recent.slice(0, 8)) {
    const item = el('div', { class: 'recent-item', title: p },
      el('span', {}, basename(p)),
      el('span', { class: 'ri-path' }, p));
    item.addEventListener('click', () => openPath(p));
    list.append(item);
  }
}

// ---------------------------------------------------------------- startup
window.__katipIsEmpty = () => !state.pdfDoc;
// Hooks for the automated end-to-end tests.
window.__katip = { state, pdfViewer, eventBus, commands, setTool, loadBytes, getCurrentBytes, applyOp, insertImageFile, renderPageToCanvas };

async function init() {
  const saved = await api.getSetting('prefs', null);
  if (saved) {
    state.prefs = {
      ...state.prefs,
      ...saved,
      toolSettings: { ...state.prefs.toolSettings, ...(saved.toolSettings || {}) },
    };
  }
  applyTheme();
  $('#sidebar').classList.toggle('hidden', !state.prefs.sidebar);
  document.body.classList.add('no-doc');
  updateUndoButtons();
  renderRecent();
  const pending = await api.pendingFile();
  if (pending) await openPath(pending);
  container.focus();
}

init();
