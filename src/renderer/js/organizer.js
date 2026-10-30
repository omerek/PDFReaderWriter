// "Sayfaları Düzenle": page grid with selection, drag-and-drop reordering and page operations.

import { $, $$, el, toast, busy, prompt } from './ui.js';
import * as dialogs from './dialogs.js';

export function initOrganizer(ctx) {
  const { state, api } = ctx;
  const root = $('#organizer');
  const grid = $('#orgGrid');
  let selected = new Set();
  let anchor = null;
  let generation = 0;
  let dragFrom = null;
  // Touch screens (Android): a tap toggles a page's selection and pages are moved from the menu.
  const touch = !!api.isMobile;

  function pageCount() {
    return state.pdfDoc ? state.pdfDoc.numPages : 0;
  }

  function updateSelLabel() {
    $('#orgSel').textContent = `${pageCount()} sayfa · ${selected.size} seçili`;
    $$('.org-page', grid).forEach((n) => n.classList.toggle('selected', selected.has(Number(n.dataset.index))));
  }

  async function render() {
    const gen = ++generation;
    grid.replaceChildren();
    const doc = state.pdfDoc;
    if (!doc) return;
    const size = Number($('#orgZoom').value);
    grid.style.setProperty('--org-size', `${size}px`);
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        const index = Number(e.target.dataset.index);
        ctx.renderPageToCanvas(index, { maxWidth: size * 1.6, maxHeight: size * 2.1, doc }).then((canvas) => {
          if (gen !== generation) return;
          e.target.querySelector('.org-img').replaceChildren(canvas);
        }).catch(() => {});
      }
    }, { root: grid, rootMargin: '400px 0px' });

    for (let i = 0; i < doc.numPages; i++) {
      const node = el('div', { class: 'org-page', 'data-index': i, draggable: touch ? 'false' : 'true' },
        el('div', { class: 'org-img' }),
        el('div', { class: 'org-num' }, i + 1));
      grid.append(node);
      observer.observe(node);
    }
    updateSelLabel();
  }

  // ----- selection
  grid.addEventListener('click', (e) => {
    const node = e.target.closest('.org-page');
    if (!node) {
      if (e.target === grid) { selected.clear(); updateSelLabel(); }
      return;
    }
    const i = Number(node.dataset.index);
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!e.ctrlKey) selected.clear();
      for (let k = a; k <= b; k++) selected.add(k);
    } else if (e.ctrlKey || touch) {
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      anchor = i;
    } else {
      selected = new Set([i]);
      anchor = i;
    }
    updateSelLabel();
  });
  grid.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.org-page');
    if (!node) return;
    close();
    ctx.goToPage(Number(node.dataset.index) + 1);
  });

  // ----- drag & drop reordering
  grid.addEventListener('dragstart', (e) => {
    const node = e.target.closest('.org-page');
    if (!node) return;
    const i = Number(node.dataset.index);
    if (!selected.has(i)) { selected = new Set([i]); updateSelLabel(); }
    dragFrom = [...selected].sort((a, b) => a - b);
    node.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'pages');
  });
  grid.addEventListener('dragend', () => {
    $$('.org-page', grid).forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  function dropTarget(e) {
    const node = e.target.closest('.org-page');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    return { node, index: Number(node.dataset.index) + (after ? 1 : 0), after };
  }
  grid.addEventListener('dragover', (e) => {
    if (!dragFrom) return;
    e.preventDefault();
    $$('.org-page', grid).forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    const t = dropTarget(e);
    if (t) t.node.classList.add(t.after ? 'drop-after' : 'drop-before');
  });
  grid.addEventListener('drop', async (e) => {
    if (!dragFrom) return;
    e.preventDefault();
    const t = dropTarget(e);
    const moving = dragFrom;
    dragFrom = null;
    if (!t) return;
    await movePages(moving, t.index);
  });

  // Moves the given pages so that they start before page index `before` (in the current order).
  async function movePages(moving, before) {
    const n = pageCount();
    const rest = [];
    for (let i = 0; i < n; i++) if (!moving.includes(i)) rest.push(i);
    const insertAt = rest.filter((i) => i < before).length;
    const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (order.every((v, i) => v === i)) return;
    const ok = await ctx.applyOp('Sayfa sırası', 'reorder', { order });
    if (ok) {
      selected = new Set(moving.map((_, k) => insertAt + k));
      await render();
    }
  }

  async function moveTo() {
    const s = selection();
    if (!s) return;
    const n = pageCount();
    const v = await prompt({
      title: 'Sayfaları taşı',
      label: `Seçili sayfalar hangi sayfanın önüne taşınsın? (1-${n}, sona taşımak için ${n + 1})`,
      value: String(Math.max(1, s[0])),
    });
    const target = parseInt(v, 10);
    if (!Number.isFinite(target) || target < 1 || target > n + 1) {
      if (v !== null) toast('Geçersiz sayfa numarası.');
      return;
    }
    await movePages(s, target - 1);
  }

  // ----- actions
  function selection() {
    if (!selected.size) {
      toast('Önce bir veya daha fazla sayfa seçin.');
      return null;
    }
    return [...selected].sort((a, b) => a - b);
  }

  async function insertFromFile(at) {
    const [p] = await api.openDialog({ title: 'Eklenecek PDF dosyasını seçin' });
    if (!p) return false;
    const { data } = await api.readFile(p);
    return !!(await ctx.applyOp('Dosyadan sayfa ekleme', 'insertFile', { at, other: data }));
  }

  const actions = {
    rotateCw: async () => { const s = selection(); if (s && await ctx.applyOp('Sayfa döndürme', 'rotate', { pages: s, delta: 90 })) await render(); },
    rotateCcw: async () => { const s = selection(); if (s && await ctx.applyOp('Sayfa döndürme', 'rotate', { pages: s, delta: -90 })) await render(); },
    delete: async () => {
      const s = selection();
      if (!s) return;
      if (await ctx.applyOp('Sayfa silme', 'remove', { pages: s })) {
        selected.clear();
        await render();
      }
    },
    duplicate: async () => { const s = selection(); if (s && await ctx.applyOp('Sayfa çoğaltma', 'duplicate', { pages: s })) { selected.clear(); await render(); } },
    extract: async () => {
      const s = selection();
      if (!s) return;
      await busy('Ayıklanıyor…', async () => {
        const bytes = await ctx.getCurrentBytes();
        const out = await api.pdfOp('extract', { bytes, pages: s });
        const target = await ctx.saveBytesAs(out, `${ctx.docBaseName()}_sayfalar.pdf`);
        if (target) toast(`${s.length} sayfa kaydedildi: ${target}`);
      });
    },
    insertBlank: async () => {
      const at = selected.size ? Math.max(...selected) + 1 : pageCount();
      if (await ctx.applyOp('Boş sayfa ekleme', 'insertBlank', { at })) { selected = new Set([at]); await render(); }
    },
    insertFile: async () => {
      const at = selected.size ? Math.max(...selected) + 1 : pageCount();
      if (await insertFromFile(at)) await render();
    },
    split: () => dialogs.split(ctx),
    selectAll: () => {
      selected = new Set([...Array(pageCount()).keys()]);
      updateSelLabel();
    },
    close: () => close(),
  };

  $$('[data-org]', root).forEach((b) => b.addEventListener('click', () => actions[b.dataset.org]?.()));
  $('#orgZoom').addEventListener('change', render);

  root.addEventListener('keydown', (e) => {
    if ($('#dialog').open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Delete') { e.preventDefault(); actions.delete(); }
    if (e.key.toLowerCase() === 'a' && e.ctrlKey) { e.preventDefault(); actions.selectAll(); }
  });

  function open() {
    if (!state.pdfDoc) return;
    selected = new Set([ctx.pdfViewer.currentPageNumber - 1]);
    anchor = ctx.pdfViewer.currentPageNumber - 1;
    root.hidden = false;
    render();
    grid.focus();
  }

  function close() {
    root.hidden = true;
    generation++;
    grid.replaceChildren();
  }

  // Right-click menu for a page in the grid (see contextmenu.js).
  function menuFor(node) {
    const i = Number(node.dataset.index);
    if (!selected.has(i)) {
      selected = new Set([i]);
      anchor = i;
      updateSelLabel();
    }
    const many = selected.size > 1;
    return [
      { id: 'rotR', label: 'Sağa döndür', run: actions.rotateCw },
      { id: 'rotL', label: 'Sola döndür', run: actions.rotateCcw },
      { id: 'dup', label: many ? 'Seçili sayfaları çoğalt' : 'Çoğalt', run: actions.duplicate },
      { id: 'ext', label: many ? 'Seçili sayfaları ayıkla…' : 'Sayfayı ayıkla…', run: actions.extract },
      { id: 'del', label: many ? 'Seçili sayfaları sil' : 'Sil', accelerator: 'Delete', enabled: selected.size < pageCount(), run: actions.delete },
      { id: 'move', label: many ? 'Seçili sayfaları taşı…' : 'Taşı…', run: moveTo },
      touch ? { id: 'first', label: 'Başa taşı', run: () => movePages([...selected].sort((a, b) => a - b), 0) } : null,
      touch ? { id: 'last', label: 'Sona taşı', run: () => movePages([...selected].sort((a, b) => a - b), pageCount()) } : null,
      { type: 'separator' },
      { id: 'blank', label: 'Sonrasına boş sayfa ekle', run: actions.insertBlank },
      { id: 'ins', label: 'Sonrasına dosyadan sayfa ekle…', run: actions.insertFile },
      { type: 'separator' },
      { id: 'go', label: 'Bu sayfayı aç', run: () => { close(); ctx.goToPage(i + 1); } },
      { id: 'all', label: 'Tümünü seç', accelerator: 'Ctrl+A', run: actions.selectAll },
    ].filter(Boolean);
  }

  return { open, close, insertFromFile, menuFor, isOpen: () => !root.hidden };
}
