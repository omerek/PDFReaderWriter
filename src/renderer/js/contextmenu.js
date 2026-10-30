// Right-click menus (shown as native Windows menus by the main process).
// Text fields get the standard Cut/Copy/Paste menu from the main process instead.

import { $, toast, prompt } from './ui.js';

const SEP = { type: 'separator' };

export function initContextMenu(ctx) {
  const { state, pdfViewer, api } = ctx;

  // ---------- selection helpers
  function selectionInViewer() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const elNode = node.nodeType === 1 ? node : node.parentElement;
    if (!elNode?.closest('#viewer')) return null;
    return { sel, range, text };
  }

  // Converts the selection's client rectangles into PDF quads, grouped by page.
  function selectionQuads(range) {
    const byPage = new Map();
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const hit = ctx.textEdit.pageAt(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit) continue;
      const vp = hit.view.viewport;
      const p = (x, y) => vp.convertToPdfPoint(x - hit.ox, y - hit.oy);
      const [tl, tr, bl, br] = [p(r.left, r.top), p(r.right, r.top), p(r.left, r.bottom), p(r.right, r.bottom)];
      if (!byPage.has(hit.index)) byPage.set(hit.index, []);
      byPage.get(hit.index).push([...tl, ...tr, ...bl, ...br]);
    }
    // Merge rectangles that belong to the same line (text layers create one per span).
    for (const [page, quads] of byPage) {
      const merged = [];
      for (const q of quads.sort((m, n) => n[1] - m[1] || m[0] - n[0])) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last[1] - q[1]) < 2 && Math.abs(last[5] - q[5]) < 2 && q[0] - last[2] < 4) {
          last[2] = Math.max(last[2], q[2]);
          last[6] = Math.max(last[6], q[6]);
        } else merged.push([...q]);
      }
      byPage.set(page, merged);
    }
    return byPage;
  }

  async function markup(kind, range) {
    const groups = selectionQuads(range);
    if (!groups.size) return;
    const hex = state.prefs.toolSettings.highlight?.color || '#FFFF98';
    const color = {
      StrikeOut: [0.86, 0.1, 0.1],
      Underline: [0.1, 0.3, 0.9],
      Highlight: [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255),
    }[kind];
    const label = { StrikeOut: 'Üstü çizili', Underline: 'Altı çizili', Highlight: 'Vurgulama' }[kind];
    for (const [page, quads] of groups) {
      await ctx.applyOp(label, 'addMarkup', {
        page, quads, kind, color, author: state.prefs.author || '',
      });
    }
    window.getSelection()?.removeAllRanges();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand('copy');
    }
  }

  async function noteAt(hit) {
    const text = await prompt({ title: 'Yapışkan not', label: 'Not metni:', multiline: true, okLabel: 'Ekle' });
    if (text === null) return;
    const hex = state.prefs.toolSettings.note.color;
    const color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    await ctx.applyOp('Not ekleme', 'addNote', { page: hit.index, x: hit.x, y: hit.y, text, color, author: state.prefs.author || '' });
  }

  function selectAllText() {
    const viewer = $('#viewer');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(viewer);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- menus
  async function viewerMenu(e) {
    const cmd = ctx.runCommand;
    const selInfo = selectionInViewer();
    const hit = ctx.textEdit.pageAt(e.clientX, e.clientY);
    const overText = hit ? await ctx.textEdit.hasTextAt(e.clientX, e.clientY) : false;
    const onEditor = e.target.closest?.('.annotationEditorLayer > *:not(canvas)');

    if (onEditor) {
      return [
        { id: 'edDelete', label: 'Sil', accelerator: 'Delete', run: () => ctx.eventBus.dispatch('editingaction', { source: null, name: 'delete' }) },
        { id: 'undo', label: 'Geri al', accelerator: 'Ctrl+Z', run: () => cmd('undo') },
        SEP,
        { id: 'selectTool', label: 'Seçim aracına dön', run: () => ctx.setTool('select') },
      ];
    }

    if (selInfo) {
      const short = selInfo.text.trim().replace(/\s+/g, ' ');
      return [
        { id: 'copy', label: 'Kopyala', accelerator: 'Ctrl+C', run: () => copyText(selInfo.text) },
        SEP,
        { id: 'hl', label: 'Metni vurgula', run: () => markup('Highlight', selInfo.range) },
        { id: 'ul', label: 'Metnin altını çiz', run: () => markup('Underline', selInfo.range) },
        { id: 'so', label: 'Metnin üstünü çiz', run: () => markup('StrikeOut', selInfo.range) },
        hit ? { id: 'note', label: 'Not ekle', run: () => noteAt(hit) } : null,
        overText ? { id: 'edit', label: 'Metni düzenle', run: () => { ctx.setTool('editText'); ctx.textEdit.startAt(e.clientX, e.clientY); } } : null,
        SEP,
        { id: 'find', label: `Bul: "${short.length > 30 ? `${short.slice(0, 30)}…` : short}"`, run: () => ctx.find(short) },
        { id: 'selAll', label: 'Tümünü seç', accelerator: 'Ctrl+A', run: selectAllText },
      ].filter(Boolean);
    }

    const page = hit ? hit.index : pdfViewer.currentPageNumber - 1;
    return [
      overText ? { id: 'edit', label: 'Metni düzenle', run: () => { ctx.setTool('editText'); ctx.textEdit.startAt(e.clientX, e.clientY); } } : null,
      hit ? { id: 'note', label: 'Buraya not ekle', run: () => noteAt(hit) } : null,
      { id: 'addText', label: 'Metin kutusu ekle', run: () => ctx.setTool('text') },
      { id: 'addImage', label: 'Resim ekle…', run: () => cmd('toolImage') },
      { id: 'sign', label: 'İmzala…', run: () => cmd('toolSign') },
      SEP,
      { id: 'tSel', label: 'Metin seçimi aracı', type: 'checkbox', checked: state.tool === 'select', run: () => ctx.setTool('select') },
      { id: 'tHand', label: 'El aracı', type: 'checkbox', checked: state.tool === 'hand', run: () => ctx.setTool('hand') },
      SEP,
      { id: 'zin', label: 'Yakınlaştır', accelerator: 'Ctrl+=', run: () => cmd('zoomIn') },
      { id: 'zout', label: 'Uzaklaştır', accelerator: 'Ctrl+-', run: () => cmd('zoomOut') },
      { id: 'fitp', label: 'Sayfaya sığdır', accelerator: 'Ctrl+0', run: () => cmd('fitPage') },
      { id: 'fitw', label: 'Genişliğe sığdır', accelerator: 'Ctrl+2', run: () => cmd('fitWidth') },
      SEP,
      { id: 'prev', label: 'Önceki sayfa', enabled: pdfViewer.currentPageNumber > 1, run: () => cmd('prevPage') },
      { id: 'next', label: 'Sonraki sayfa', enabled: pdfViewer.currentPageNumber < pdfViewer.pagesCount, run: () => cmd('nextPage') },
      SEP,
      { id: 'rotR', label: 'Sayfayı sağa döndür', run: () => ctx.applyOp('Sayfa döndürme', 'rotate', { pages: [page], delta: 90 }) },
      { id: 'rotL', label: 'Sayfayı sola döndür', run: () => ctx.applyOp('Sayfa döndürme', 'rotate', { pages: [page], delta: -90 }) },
      { id: 'del', label: 'Sayfayı sil', enabled: pdfViewer.pagesCount > 1, run: () => ctx.applyOp('Sayfa silme', 'remove', { pages: [page] }) },
      SEP,
      { id: 'selAll', label: 'Tümünü seç', accelerator: 'Ctrl+A', run: selectAllText },
      { id: 'print', label: 'Yazdır…', accelerator: 'Ctrl+P', run: () => cmd('print') },
      { id: 'props', label: 'Belge özellikleri…', accelerator: 'Ctrl+D', run: () => cmd('properties') },
    ].filter(Boolean);
  }

  function thumbMenu(thumb) {
    const page = Number(thumb.dataset.page) - 1;
    const op = (label, name, args) => () => ctx.applyOp(label, name, args);
    return [
      { id: 'go', label: 'Bu sayfaya git', run: () => ctx.goToPage(page + 1) },
      SEP,
      { id: 'rotR', label: 'Sağa döndür', run: op('Sayfa döndürme', 'rotate', { pages: [page], delta: 90 }) },
      { id: 'rotL', label: 'Sola döndür', run: op('Sayfa döndürme', 'rotate', { pages: [page], delta: -90 }) },
      { id: 'dup', label: 'Çoğalt', run: op('Sayfa çoğaltma', 'duplicate', { pages: [page] }) },
      { id: 'blankB', label: 'Öncesine boş sayfa ekle', run: op('Boş sayfa ekleme', 'insertBlank', { at: page }) },
      { id: 'blankA', label: 'Sonrasına boş sayfa ekle', run: op('Boş sayfa ekleme', 'insertBlank', { at: page + 1 }) },
      { id: 'ins', label: 'Sonrasına dosyadan sayfa ekle…', run: () => ctx.organizer.insertFromFile(page + 1) },
      { id: 'ext', label: 'Sayfayı ayıkla…', run: () => ctx.extractPages([page]) },
      { id: 'del', label: 'Sayfayı sil', enabled: pdfViewer.pagesCount > 1, run: op('Sayfa silme', 'remove', { pages: [page] }) },
      SEP,
      { id: 'org', label: 'Sayfaları düzenle', run: () => ctx.runCommand('organize') },
    ];
  }

  function show(items) {
    const clean = items.filter((it, i, arr) => !(it.type === 'separator' && (i === 0 || arr[i - 1].type === 'separator' || i === arr.length - 1)));
    const actions = new Map();
    const template = clean.map((it) => {
      if (it.type === 'separator') return { type: 'separator' };
      actions.set(it.id, it.run);
      return { id: it.id, label: it.label, accelerator: it.accelerator, enabled: it.enabled !== false, type: it.type, checked: it.checked };
    });
    return api.contextMenu(template).then((id) => {
      const fn = id && actions.get(id);
      if (fn) Promise.resolve(fn()).catch((err) => toast(String(err.message || err), { error: true }));
      return id;
    });
  }

  // Items for a point, exported for the automated tests.
  async function itemsFor(e) {
    const target = e.target;
    if (target.closest?.('.org-page')) return ctx.organizer.menuFor(target.closest('.org-page'));
    if (target.closest?.('#thumbs .thumb')) return thumbMenu(target.closest('.thumb'));
    if (target.closest?.('#viewerContainer') && state.pdfDoc) return viewerMenu(e);
    if (!state.pdfDoc) return [{ id: 'open', label: 'Aç…', accelerator: 'Ctrl+O', run: () => ctx.runCommand('open') }];
    return null;
  }

  document.addEventListener('contextmenu', async (e) => {
    const t = e.target;
    // Text inputs: let the main process show Cut/Copy/Paste.
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
    e.preventDefault();
    if ($('#dialog').open) return;
    const items = await itemsFor(e);
    if (items && items.length) show(items);
  });

  return { itemsFor, show, selectionQuads, markup };
}
