// Left sidebar: page thumbnails, bookmarks (outline), annotation list and attachments.

import { $, $$, el, icon, toast } from './ui.js';

const THUMB_WIDTH = 150;

export function initSidebar(ctx) {
  const { state, linkService, api } = ctx;
  let generation = 0;
  let observer = null;
  let current = 1;
  let loadedPanels = new Set();

  // ----- tabs
  $$('.sb-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.sb-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.sb-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.panel}`));
    loadPanel(tab.dataset.panel);
  }));

  // ----- resizer
  const resizer = $('#sidebarResizer');
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = $('#sidebar').getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(150, Math.min(480, startW + ev.clientX - startX));
      document.documentElement.style.setProperty('--sb-w', `${w}px`);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      ctx.pdfViewer.update();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  function activePanel() {
    return $('.sb-tab.active')?.dataset.panel || 'thumbs';
  }

  function loadPanel(name) {
    if (!state.pdfDoc || loadedPanels.has(name)) return;
    loadedPanels.add(name);
    const doc = state.pdfDoc;
    const gen = generation;
    if (name === 'outline') buildOutline(doc, gen);
    if (name === 'annots') buildAnnotations(doc, gen);
    if (name === 'attach') buildAttachments(doc, gen);
  }

  // ----- thumbnails
  function buildThumbs(doc, gen) {
    const box = $('#thumbs');
    box.replaceChildren();
    observer?.disconnect();
    if (!doc) return;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        observer.unobserve(node);
        renderThumb(doc, gen, node);
      }
    }, { root: $('#panel-thumbs'), rootMargin: '300px 0px' });

    doc.getPage(1).then((p1) => {
      const vp = p1.getViewport({ scale: 1 });
      const ratio = vp.height / vp.width;
      for (let i = 1; i <= doc.numPages; i++) {
        const img = el('div', { class: 'thumb-img', style: { width: `${THUMB_WIDTH}px`, height: `${Math.round(THUMB_WIDTH * ratio)}px` } });
        const node = el('div', { class: `thumb${i === current ? ' current' : ''}`, 'data-page': i, title: `Sayfa ${i}` }, img, el('span', {}, i));
        node.addEventListener('click', () => ctx.goToPage(i));
        box.append(node);
        observer.observe(node);
      }
    }).catch(() => {});
  }

  async function renderThumb(doc, gen, node) {
    if (gen !== generation) return;
    const index = Number(node.dataset.page) - 1;
    try {
      const canvas = await ctx.renderPageToCanvas(index, { maxWidth: THUMB_WIDTH * 2, doc });
      if (gen !== generation) return;
      canvas.style.width = '100%';
      const box = node.querySelector('.thumb-img');
      box.style.height = 'auto';
      box.replaceChildren(canvas);
    } catch {
      // Page could not be rendered (document closed meanwhile).
    }
  }

  function setCurrentPage(n) {
    current = n;
    $$('#thumbs .thumb.current').forEach((t) => t.classList.remove('current'));
    const node = $(`#thumbs .thumb[data-page="${n}"]`);
    if (node) {
      node.classList.add('current');
      if (activePanel() === 'thumbs') node.scrollIntoView({ block: 'nearest' });
    }
  }

  // ----- outline
  async function buildOutline(doc, gen) {
    const box = $('#outline');
    box.replaceChildren();
    const outline = await doc.getOutline().catch(() => null);
    if (gen !== generation) return;
    if (!outline || !outline.length) {
      box.append(el('div', { class: 'empty-note' }, 'Bu belgede yer imi yok.'));
      return;
    }
    const build = (items, parent, depth) => {
      for (const item of items) {
        const hasKids = item.items && item.items.length;
        const row = el('div', { class: `tree-item${hasKids && depth > 0 ? ' collapsed' : ''}` });
        const toggle = el('button', { class: 'tree-toggle', type: 'button' });
        if (hasKids) {
          toggle.append(icon('next'));
          toggle.addEventListener('click', () => row.classList.toggle('collapsed'));
        }
        const link = el('div', { class: 'tree-link', title: item.title }, item.title || '(adsız)');
        if (item.bold) link.style.fontWeight = '600';
        if (item.italic) link.style.fontStyle = 'italic';
        link.addEventListener('click', () => {
          if (item.dest) linkService.goToDestination(item.dest);
          else if (item.url) window.open(item.url, '_blank');
        });
        row.append(toggle, link);
        parent.append(row);
        if (hasKids) {
          const kids = el('div', { class: 'tree-children' });
          parent.append(kids);
          build(item.items, kids, depth + 1);
        }
      }
    };
    build(outline, box, 0);
  }

  // ----- annotations
  const ANNOT_NAMES = {
    Text: 'Not', FreeText: 'Metin', Highlight: 'Vurgu', Underline: 'Altı çizili', StrikeOut: 'Üstü çizili',
    Squiggly: 'Dalgalı çizgi', Ink: 'Çizim', Square: 'Dikdörtgen', Circle: 'Elips', Line: 'Çizgi',
    Polygon: 'Çokgen', PolyLine: 'Çoklu çizgi', Stamp: 'Damga / Resim', Caret: 'İşaret', FileAttachment: 'Ek dosya',
  };

  async function buildAnnotations(doc, gen) {
    const box = $('#annotList');
    box.replaceChildren(el('div', { class: 'empty-note' }, 'Yükleniyor…'));
    const items = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (gen !== generation) return;
      const page = await doc.getPage(i);
      const annots = await page.getAnnotations().catch(() => []);
      for (const a of annots) {
        if (!ANNOT_NAMES[a.subtype]) continue;
        items.push({ page: i, a });
      }
    }
    if (gen !== generation) return;
    box.replaceChildren();
    if (!items.length) {
      box.append(el('div', { class: 'empty-note' }, 'Bu belgede açıklama yok.'));
      return;
    }
    for (const { page, a } of items) {
      const author = a.titleObj?.str || '';
      const text = a.contentsObj?.str || a.textContent?.join(' ') || '';
      const node = el('div', { class: 'list-item' },
        el('div', { class: 'li-meta' }, `${ANNOT_NAMES[a.subtype]} · Sayfa ${page}${author ? ` · ${author}` : ''}`),
        text ? el('div', { class: 'li-text' }, text) : null);
      node.addEventListener('click', () => ctx.goToPage(page));
      box.append(node);
    }
  }

  // ----- attachments
  async function buildAttachments(doc, gen) {
    const box = $('#attachList');
    box.replaceChildren();
    const att = await doc.getAttachments().catch(() => null);
    if (gen !== generation) return;
    const entries = att ? Object.values(att) : [];
    if (!entries.length) {
      box.append(el('div', { class: 'empty-note' }, 'Bu belgede ek dosya yok.'));
      return;
    }
    for (const f of entries) {
      const name = f.filename || 'ek';
      const node = el('div', { class: 'list-item', title: 'Kaydetmek için tıklayın' }, el('div', { class: 'li-text' }, name),
        el('div', { class: 'li-meta' }, `${Math.round((f.content?.length || 0) / 1024)} KB`));
      node.addEventListener('click', async () => {
        const target = await api.saveDialog({ title: 'Eki kaydet', defaultPath: name, filters: [{ name: 'Tüm Dosyalar', extensions: ['*'] }] });
        if (!target) return;
        await api.writeFile(target, f.content);
        toast('Ek kaydedildi');
      });
      box.append(node);
    }
  }

  function onDocument(doc) {
    generation++;
    loadedPanels = new Set();
    current = ctx.pdfViewer.currentPageNumber || 1;
    buildThumbs(doc, generation);
    $('#outline').replaceChildren();
    $('#annotList').replaceChildren();
    $('#attachList').replaceChildren();
    if (doc && activePanel() !== 'thumbs') loadPanel(activePanel());
  }

  return { onDocument, setCurrentPage };
}
