// "Sayfaları Düzenle": page grid with selection, drag-and-drop reordering and page operations.

import { $, $$, el, toast, busy } from './ui.js';
import * as dialogs from './dialogs.js';

export function initOrganizer(ctx) {
  const { state, api } = ctx;
  const root = $('#organizer');
  const grid = $('#orgGrid');
  let selected = new Set();
  let anchor = null;
  let generation = 0;
  let dragFrom = null;

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
      const node = el('div', { class: 'org-page', 'data-index': i, draggable: 'true' },
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
    } else if (e.ctrlKey) {
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
    const n = pageCount();
    const rest = [];
    for (let i = 0; i < n; i++) if (!moving.includes(i)) rest.push(i);
    const insertAt = rest.filter((i) => i < t.index).length;
    const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (order.every((v, i) => v === i)) return;
    const ok = await ctx.applyOp('Sayfa sırası', 'reorder', { order });
    if (ok) {
      selected = new Set(moving.map((_, k) => insertAt + k));
      await render();
    }
  });

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

  return { open, close, insertFromFile, isOpen: () => !root.hidden };
}
