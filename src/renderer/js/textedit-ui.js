// "Metni Düzenle": click a line of the original PDF text, edit it in place, and the
// main process swaps the glyphs in the page content (see src/main/textedit.js).

import { $, el, toast } from './ui.js';

const CSS_FAMILY = {
  sans: '"Katip Sans", "Liberation Sans", Arial, sans-serif',
  serif: '"Katip Serif", "Liberation Serif", "Times New Roman", serif',
  mono: '"Katip Mono", "Liberation Mono", "Courier New", monospace',
};

export function initTextEdit(ctx) {
  const { state, pdfViewer } = ctx;
  const textCache = new Map(); // pageIndex -> Promise<{ items, styles, page }>
  let active = null; // current editor

  ctx.eventBus.on('pagesinit', () => textCache.clear());

  function pageAt(clientX, clientY) {
    const pageEl = document.elementsFromPoint(clientX, clientY).find((n) => n.classList?.contains('page'));
    if (!pageEl) return null;
    const index = Number(pageEl.dataset.pageNumber) - 1;
    const view = pdfViewer.getPageView(index);
    if (!view?.pdfPage) return null;
    const rect = pageEl.getBoundingClientRect();
    const style = getComputedStyle(pageEl);
    const ox = rect.left + (parseFloat(style.borderLeftWidth) || 0);
    const oy = rect.top + (parseFloat(style.borderTopWidth) || 0);
    const [x, y] = view.viewport.convertToPdfPoint(clientX - ox, clientY - oy);
    return { pageEl, index, view, x, y, ox, oy };
  }

  function textOf(index, page) {
    if (!textCache.has(index)) {
      textCache.set(index, page.getTextContent().then((tc) => ({ items: tc.items, styles: tc.styles, page })));
    }
    return textCache.get(index);
  }

  // Finds the text item (a line or run of text) under a PDF point.
  async function itemAt(hit) {
    const { items, styles, page } = await textOf(hit.index, hit.view.pdfPage);
    let best = null;
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const lu = Math.hypot(a, b) || 1;
      const lv = Math.hypot(c, d) || 1;
      const h = it.height || lv;
      const dx = hit.x - e;
      const dy = hit.y - f;
      const s = (dx * a + dy * b) / lu;
      const t = (dx * c + dy * d) / lv;
      if (s >= -2 && s <= it.width + 2 && t >= -0.3 * h && t <= 1.05 * h) {
        const dist = Math.abs(t - 0.35 * h);
        if (!best || dist < best.dist) best = { it, dist };
      }
    }
    if (!best) return null;
    return { item: best.it, style: styles[best.it.fontName] || {}, page };
  }

  function fontOf(page, fontName, style) {
    let name = '';
    try {
      if (page.commonObjs.has(fontName)) name = page.commonObjs.get(fontName)?.name || '';
    } catch {
      name = '';
    }
    const fam = String(style.fontFamily || '');
    const lower = `${name} ${fam}`.toLowerCase();
    let family = 'sans';
    if (/mono|courier|consol/.test(lower)) family = 'mono';
    else if (/serif/.test(fam) && !/sans/.test(fam)) family = 'serif';
    else if (/times|georgia|garamond|cambria|book|roman|minion|tinos|liberationserif|dejavuserif/.test(lower)) family = 'serif';
    return {
      family,
      bold: /bold|black|heavy|semibold|demi/.test(lower),
      italic: /italic|oblique/.test(lower),
    };
  }

  // Picks the ink colour of the text from the rendered page canvas.
  function sampleColor(view, rect) {
    const canvas = view.canvas || view.div.querySelector('canvas');
    if (!canvas) return '#000000';
    try {
      const sx = canvas.width / view.viewport.width;
      const sy = canvas.height / view.viewport.height;
      const x = Math.max(0, Math.floor(rect.left * sx));
      const y = Math.max(0, Math.floor(rect.top * sy));
      const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(rect.width * sx)));
      const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(rect.height * sy)));
      const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
      let best = null;
      const samples = [];
      for (let k = 0; k < data.length; k += 4) {
        const dist = 765 - (data[k] + data[k + 1] + data[k + 2]);
        if (dist > 120) samples.push([dist, data[k], data[k + 1], data[k + 2]]);
      }
      if (!samples.length) return '#000000';
      samples.sort((p, q) => q[0] - p[0]);
      best = samples[Math.floor(samples.length * 0.15)];
      return `#${best.slice(1).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return '#000000';
    }
  }

  function close() {
    active?.root.remove();
    active = null;
  }

  async function startAt(clientX, clientY) {
    if (!state.pdfDoc) return false;
    const hit = pageAt(clientX, clientY);
    if (!hit) return false;
    const found = await itemAt(hit);
    if (!found) {
      toast('Burada düzenlenebilir metin bulunamadı. Taranmış sayfalarda metin resim olarak durur.');
      return false;
    }
    open(hit, found);
    return true;
  }

  function open(hit, { item, style, page }) {
    close();
    const { view } = hit;
    const vp = view.viewport;
    const [a, b, c, d, e, f] = item.transform;
    const lu = Math.hypot(a, b) || 1;
    const lv = Math.hypot(c, d) || 1;
    const height = item.height || lv;
    // Bounding box in viewport pixels (axis-aligned).
    const pts = [[0, -0.25], [1, -0.25], [0, 1], [1, 1]].map(([s, t]) => {
      const px = e + (a / lu) * s * item.width + (c / lv) * t * height;
      const py = f + (b / lu) * s * item.width + (d / lv) * t * height;
      return vp.convertToViewportPoint(px, py);
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const rect = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const font = fontOf(page, item.fontName, style);
    const color = sampleColor(view, rect);
    const size = Math.round(height * 10) / 10;

    const input = el('div', {
      class: 'te-input',
      contenteditable: 'plaintext-only',
      spellcheck: 'false',
      style: {
        left: `${rect.left - 2}px`,
        top: `${rect.top - 1}px`,
        minWidth: `${rect.width + 4}px`,
        height: `${rect.height + 2}px`,
        lineHeight: `${rect.height}px`,
        fontSize: `${size * vp.scale}px`,
      },
    }, item.str);

    const famSel = el('select', { title: 'Yazı tipi' },
      [['sans', 'Sans (Arial)'], ['serif', 'Serif (Times)'], ['mono', 'Mono (Courier)']]
        .map(([v, l]) => el('option', { value: v, selected: v === font.family }, l)));
    const sizeIn = el('input', { type: 'number', min: 4, max: 200, step: 0.5, value: size, title: 'Yazı boyutu (pt)' });
    const boldBtn = el('button', { type: 'button', class: `te-btn${font.bold ? ' on' : ''}`, title: 'Kalın' }, el('b', {}, 'K'));
    const italBtn = el('button', { type: 'button', class: `te-btn${font.italic ? ' on' : ''}`, title: 'İtalik' }, el('i', {}, 'T'));
    const colorIn = el('input', { type: 'color', value: color, title: 'Renk' });
    const ok = el('button', { type: 'button', class: 'btn primary small-btn' }, 'Uygula');
    const cancel = el('button', { type: 'button', class: 'btn small-btn' }, 'İptal');
    const bar = el('div', { class: 'te-bar', style: { left: `${rect.left - 2}px`, top: `${Math.max(0, rect.top - 40)}px` } },
      famSel, sizeIn, boldBtn, italBtn, colorIn, ok, cancel);
    const root = el('div', { class: 'te-root' }, input, bar);

    const restyle = () => {
      input.style.fontFamily = CSS_FAMILY[famSel.value];
      input.style.fontWeight = boldBtn.classList.contains('on') ? '700' : '400';
      input.style.fontStyle = italBtn.classList.contains('on') ? 'italic' : 'normal';
      input.style.color = colorIn.value;
      input.style.fontSize = `${Number(sizeIn.value || size) * vp.scale}px`;
    };
    boldBtn.addEventListener('click', () => { boldBtn.classList.toggle('on'); restyle(); input.focus(); });
    italBtn.addEventListener('click', () => { italBtn.classList.toggle('on'); restyle(); input.focus(); });
    famSel.addEventListener('change', restyle);
    sizeIn.addEventListener('input', restyle);
    colorIn.addEventListener('input', restyle);
    restyle();

    const commit = async () => {
      const text = input.textContent.replace(/\s+$/u, '');
      const changedStyle = famSel.value !== font.family || boldBtn.classList.contains('on') !== font.bold
        || italBtn.classList.contains('on') !== font.italic || Number(sizeIn.value) !== size || colorIn.value !== color;
      if (text === item.str && !changedStyle) { close(); return; }
      const hex = colorIn.value;
      const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
      close();
      await ctx.applyOp('Metin düzenleme', 'editText', {
        page: hit.index,
        item: { transform: item.transform, width: item.width, height },
        text,
        font: { family: famSel.value, bold: boldBtn.classList.contains('on'), italic: italBtn.classList.contains('on') },
        size: Number(sizeIn.value) || size,
        color: rgb,
      });
    };
    ok.addEventListener('click', commit);
    cancel.addEventListener('click', close);
    root.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    });
    root.addEventListener('mousedown', (ev) => ev.stopPropagation());
    root.addEventListener('click', (ev) => ev.stopPropagation());

    hit.pageEl.append(root);
    active = { root, commit };
    input.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Clicking text while the tool is active starts editing.
  $('#viewerContainer').addEventListener('click', (e) => {
    if (state.tool !== 'editText' || e.button !== 0) return;
    if (e.target.closest('.te-root')) return;
    e.preventDefault();
    e.stopPropagation();
    if (active) { active.commit(); return; }
    startAt(e.clientX, e.clientY);
  }, true);

  return {
    startAt,
    close,
    isEditing: () => !!active,
    hasTextAt: async (clientX, clientY) => {
      const hit = pageAt(clientX, clientY);
      return !!(hit && (await itemAt(hit)));
    },
    pageAt,
  };
}
