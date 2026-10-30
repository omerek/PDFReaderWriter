// Touch adaptations of the shared renderer for Android: bottom-sheet menus (instead of native
// right-click menus), long-press, a selection action bar, pinch-to-zoom, the overflow ("⋮") menu
// that replaces the desktop menu bar, and the Android back button.

import { el, showDialog, alertDialog } from '../renderer/js/ui.js';

const $ = (s, r = document) => r.querySelector(s);

// ------------------------------------------------------------------ bottom sheet
let closeOpenSheet = null;

/**
 * Shows a list of menu items as a bottom sheet. Items use the desktop context-menu format
 * ({ id, label, enabled, type: 'checkbox' | 'separator', checked }) plus { type: 'header', label }.
 * Resolves with the chosen id, or null when dismissed.
 */
export function actionSheet(items, { title } = {}) {
  closeOpenSheet?.(null);
  return new Promise((resolve) => {
    const list = el('div', { class: 'msheet-list', role: 'menu' });
    if (title) list.append(el('div', { class: 'msheet-title' }, title));
    for (const it of items || []) {
      if (!it) continue;
      if (it.type === 'separator') { list.append(el('div', { class: 'msheet-sep' })); continue; }
      if (it.type === 'header') { list.append(el('div', { class: 'msheet-header' }, it.label)); continue; }
      const btn = el('button', {
        class: `msheet-item${it.type === 'checkbox' ? ' check' : ''}${it.checked ? ' checked' : ''}`,
        type: 'button',
        role: 'menuitem',
        disabled: it.enabled === false,
      }, el('span', {}, it.label));
      btn.addEventListener('click', () => done(it.id));
      list.append(btn);
    }
    const sheet = el('div', { class: 'msheet' }, el('div', { class: 'msheet-handle' }), list);
    const backdrop = el('div', { class: 'msheet-backdrop' }, sheet);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    backdrop.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    function done(id) {
      if (closeOpenSheet !== done) return;
      closeOpenSheet = null;
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 180);
      // Let the sheet close before the chosen command opens its own UI.
      setTimeout(() => resolve(id), 0);
    }
    closeOpenSheet = done;
  });
}

// Replacement for the desktop's native message box: resolves with the button index.
export async function confirmSheet(opts = {}) {
  const buttons = opts.buttons || ['Tamam', 'İptal'];
  const cancelId = opts.cancelId ?? 1;
  const res = await showDialog({
    title: opts.message || '',
    body: opts.detail ? el('p', { style: { whiteSpace: 'pre-wrap' } }, opts.detail) : null,
    buttons: buttons.map((label, i) => ({ label, value: i, primary: i === (opts.defaultId ?? 0) })),
  });
  return res === null || res === undefined ? cancelId : res;
}

// ------------------------------------------------------------------ overflow menu
function overflowMenu(k) {
  const { state, pdfViewer } = k;
  const doc = !!state.pdfDoc;
  const item = (id, label, extra = {}) => ({ id, label, ...extra });
  const docItem = (id, label, extra = {}) => item(id, label, { enabled: doc, ...extra });
  const layout = doc ? `${pdfViewer.scrollMode}/${pdfViewer.spreadMode}` : '';
  return [
    { type: 'header', label: 'Dosya' },
    item('open', 'Aç…'),
    item('recent', 'Son kullanılanlar…'),
    docItem('save', 'Kaydet'),
    docItem('saveAs', 'Farklı kaydet…'),
    docItem('share', 'Paylaş…'),
    docItem('print', 'Yazdır…'),
    item('merge', 'Dosyaları birleştir…'),
    docItem('split', 'Belgeyi böl…'),
    docItem('exportImages', 'Sayfaları resim olarak dışa aktar…'),
    item('imagesToPdf', 'Resimlerden PDF…'),
    docItem('properties', 'Belge özellikleri'),
    docItem('close', 'Belgeyi kapat'),
    { type: 'header', label: 'Düzen' },
    docItem('find', 'Bul…'),
    docItem('gotoPage', 'Sayfaya git…'),
    item('preferences', 'Tercihler…'),
    { type: 'header', label: 'Görünüm' },
    docItem('fitWidth', 'Genişliğe sığdır'),
    docItem('fitPage', 'Sayfaya sığdır'),
    docItem('actualSize', 'Gerçek boyut'),
    docItem('rotateViewCw', 'Görünümü döndür'),
    docItem('layoutContinuous', 'Sürekli kaydırma', { type: 'checkbox', checked: layout === '0/0' }),
    docItem('layoutSingle', 'Tek sayfa', { type: 'checkbox', checked: layout === '3/0' }),
    docItem('layoutTwo', 'İki sayfa', { type: 'checkbox', checked: layout === '0/1' }),
    docItem('layoutHorizontal', 'Yatay kaydırma', { type: 'checkbox', checked: layout === '1/0' }),
    item('toggleSidebar', 'Kenar çubuğu', { type: 'checkbox', checked: !$('#sidebar').classList.contains('hidden') }),
    docItem('presentation', 'Tam ekran okuma'),
    item('toggleTheme', 'Koyu / açık tema'),
    docItem('nightMode', 'Gece okuma modu', { type: 'checkbox', checked: document.body.classList.contains('night') }),
    { type: 'header', label: 'Sayfalar' },
    docItem('organize', 'Sayfaları düzenle'),
    docItem('rotatePagesCw', 'Geçerli sayfayı sağa döndür'),
    docItem('rotatePagesCcw', 'Geçerli sayfayı sola döndür'),
    docItem('insertBlank', 'Boş sayfa ekle'),
    docItem('insertFile', 'Dosyadan sayfa ekle…'),
    docItem('extractPages', 'Sayfaları ayıkla…'),
    docItem('deletePage', 'Geçerli sayfayı sil', { enabled: doc && pdfViewer.pagesCount > 1 }),
    docItem('flattenForm', 'Form alanlarını düzleştir'),
    { type: 'header', label: 'Yardım' },
    item('about', 'Katip PDF hakkında'),
    item('licenses', 'Lisanslar'),
  ];
}

async function showRecent(k, api) {
  const recent = (await api.getSetting('recent', [])) || [];
  if (!recent.length) {
    await actionSheet([{ id: 'none', label: 'Liste boş', enabled: false }], { title: 'Son kullanılanlar' });
    return;
  }
  const items = recent.map((p, i) => ({ id: String(i), label: String(p).split('/').pop() }));
  items.push({ type: 'separator' }, { id: 'clear', label: 'Listeyi temizle' });
  const id = await actionSheet(items, { title: 'Son kullanılanlar' });
  if (id === 'clear') { await api.setSetting('recent', []); return; }
  if (id !== null) await k.ctx.openPath(recent[Number(id)]);
}

async function showLicenses() {
  let text = '';
  try {
    text = await (await fetch('/THIRD_PARTY_NOTICES.txt')).text();
  } catch {
    text = 'Lisans dosyası okunamadı.';
  }
  await alertDialog('Lisanslar', text);
}

// ------------------------------------------------------------------ setup
export function startMobileUI(api) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startMobileUI(api), { once: true });
    return;
  }
  // The renderer module finishes loading asynchronously (top-level await); wait for its hooks.
  if (!window.__katip) {
    setTimeout(() => startMobileUI(api), 30);
    return;
  }
  const k = window.__katip;
  const { state, pdfViewer, eventBus } = k;
  const container = $('#viewerContainer');
  const sidebar = $('#sidebar');
  const narrow = () => window.innerWidth < 760;

  // ----- toolbar: share + overflow menu buttons
  const defs = $('svg defs');
  defs.insertAdjacentHTML('beforeend',
    '<symbol id="i-share" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></symbol>'
    + '<symbol id="i-kebab" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></symbol>');
  const firstGroup = $('#toolbar .tb-group');
  firstGroup.querySelector('[data-cmd="print"]')?.after(
    el('button', { class: 'tb doc-only', 'data-cmd': 'share', title: 'Paylaş' }, svgUse('share')),
  );
  const menuBtn = el('button', { class: 'tb', id: 'mobileMenuBtn', title: 'Menü' }, svgUse('kebab'));
  $('#toolbar').append(menuBtn);

  const extra = {
    recent: () => showRecent(k, api),
    licenses: () => showLicenses(),
  };
  menuBtn.addEventListener('click', async () => {
    const id = await actionSheet(overflowMenu(k));
    if (!id) return;
    if (extra[id]) await extra[id]();
    else await k.ctx.runCommand(id);
  });

  // ----- sidebar as a drawer on phones
  sidebar.addEventListener('click', (e) => {
    if (!narrow()) return;
    if (e.target.closest('#thumbs .thumb, #outline a, #outline .tree-item, #annotList > *')) {
      setTimeout(() => sidebar.classList.add('hidden'), 150);
    }
  });
  // Tapping the page area closes an open drawer.
  container.addEventListener('pointerdown', () => {
    if (narrow() && !sidebar.classList.contains('hidden')) sidebar.classList.add('hidden');
  });

  // ----- long press -> contextmenu (when the WebView does not send one itself)
  let lastContextMenu = 0;
  let press = null;
  window.addEventListener('contextmenu', (e) => {
    lastContextMenu = Date.now();
    // Over page text, let Android select the word; the selection bar offers the actions.
    const t = e.target;
    if (t.closest?.('#viewer .textLayer') && !t.classList.contains('textLayer') && state.tool === 'select') {
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    clearTimeout(press?.timer);
    const start = Date.now();
    press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        const p = press;
        press = null;
        if (!p || lastContextMenu >= start) return;
        const target = document.elementFromPoint(p.x, p.y);
        target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
      }, 650),
    };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, true);
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, () => { clearTimeout(press?.timer); press = null; }, true);
  }

  // ----- selection action bar
  const selBar = el('div', { id: 'selBar', hidden: true });
  let savedRange = null;
  let hideTimer = null;
  const selButtons = [
    ['Kopyala', async () => {
      const text = savedRange?.toString() || '';
      try { await navigator.clipboard.writeText(text); } catch { document.execCommand('copy'); }
    }],
    ['Vurgula', () => k.ctx.contextMenu.markup('Highlight', savedRange)],
    ['Altını çiz', () => k.ctx.contextMenu.markup('Underline', savedRange)],
    ['Üstünü çiz', () => k.ctx.contextMenu.markup('StrikeOut', savedRange)],
    ['Diğer…', async () => {
      const r = savedRange.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = document.elementFromPoint(x, y) || container;
      // Restore the selection so the menu sees it.
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      const items = await k.ctx.contextMenu.itemsFor({ target, clientX: x, clientY: y });
      if (items?.length) await k.ctx.contextMenu.show(items);
    }],
  ];
  for (const [label, fn] of selButtons) {
    const b = el('button', { type: 'button', class: 'btn' }, label);
    b.addEventListener('click', async () => {
      if (!savedRange) return;
      selBar.hidden = true;
      try { await fn(); } catch (err) { console.error(err); }
    });
    selBar.append(b);
  }
  document.body.append(selBar);
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const inViewer = sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim()
      && (sel.anchorNode?.parentElement || sel.anchorNode)?.closest?.('#viewer');
    clearTimeout(hideTimer);
    if (inViewer && state.tool === 'select') {
      savedRange = sel.getRangeAt(0).cloneRange();
      selBar.hidden = false;
    } else {
      hideTimer = setTimeout(() => { selBar.hidden = true; }, 400);
    }
  });

  // ----- pinch to zoom (and two-finger pan)
  let pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || !state.pdfDoc) return;
    const [a, b] = e.touches;
    pinch = { d: dist(a, b), m: mid(a, b), scale: pdfViewer.currentScale };
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const m = mid(a, b);
    const target = Math.min(8, Math.max(0.25, pinch.scale * (dist(a, b) / pinch.d)));
    const factor = target / pdfViewer.currentScale;
    const pan = [m[0] - pinch.m[0], m[1] - pinch.m[1]];
    pinch.m = m;
    if (Math.abs(factor - 1) < 0.01 && !pan[0] && !pan[1]) return;
    pdfViewer.updateScale({ drawingDelay: 300, scaleFactor: Math.abs(factor - 1) < 0.01 ? 1 : factor, origin: m, pan });
  }, { passive: false });
  container.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  container.addEventListener('touchcancel', () => { pinch = null; });

  // Double tap: toggle between fit-to-width and 2x around the tap point.
  let lastTap = 0;
  const taps = new Map(); // pointerId -> { x, y, t }
  let multi = false;
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now() });
    if (taps.size > 1) multi = true;
  });
  container.addEventListener('pointercancel', (e) => { taps.delete(e.pointerId); });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const down = taps.get(e.pointerId);
    taps.delete(e.pointerId);
    const wasMulti = multi;
    if (!taps.size) multi = false;
    if (!down || wasMulti || pinch || !state.pdfDoc || (state.tool !== 'select' && state.tool !== 'hand')) { lastTap = 0; return; }
    const now = Date.now();
    if (now - down.t > 300 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { lastTap = 0; return; }
    if (now - lastTap < 320) {
      lastTap = 0;
      if (window.getSelection()?.toString()) return;
      if (pdfViewer.currentScaleValue === 'page-width') {
        pdfViewer.updateScale({ scaleFactor: 2, origin: [e.clientX, e.clientY] });
      } else {
        pdfViewer.currentScaleValue = 'page-width';
      }
    } else {
      lastTap = now;
    }
  });

  // ----- Android back button
  api.on('mobile:back', async () => {
    const dlg = $('#dialog');
    if (closeOpenSheet) { closeOpenSheet(null); return; }
    if (dlg.open) { dlg.close(); return; }
    if (!selBar.hidden) { window.getSelection()?.removeAllRanges(); selBar.hidden = true; return; }
    if (document.body.classList.contains('presentation')) { await k.ctx.runCommand('presentation'); return; }
    if (k.ctx.organizer.isOpen()) { k.ctx.organizer.close(); return; }
    if (!$('#findbar').hidden) { $('#findClose').click(); return; }
    if (narrow() && !sidebar.classList.contains('hidden')) { sidebar.classList.add('hidden'); return; }
    if (state.pdfDoc && state.tool !== 'select') { k.setTool('select'); return; }
    if (state.pdfDoc) { await k.ctx.runCommand('close'); return; }
    api.emit('app:request-close');
  });

  // ----- system bar colours follow the theme
  const syncBars = () => {
    const bg = getComputedStyle($('#toolbar')).backgroundColor;
    api.setBarsColor(rgbToHex(bg), document.documentElement.dataset.theme === 'dark');
  };
  new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncBars();

  // Exposed for the automated tests.
  window.__katipMobile = { actionSheet, overflowMenu: () => overflowMenu(k), eventBus };
}

function svgUse(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function rgbToHex(rgb) {
  const m = String(rgb).match(/\d+/g);
  if (!m) return '#f3f4f6';
  return `#${m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}
