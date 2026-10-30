// Signature dialog: draw, type or load an image; saved signatures are reused.
// Returns a PNG Blob with a transparent background, or null.

import { el, icon, showDialog } from './ui.js';

const PAD_W = 560;
const PAD_H = 200;
const TYPE_FONTS = [
  { label: 'El yazısı', css: 'italic 52px "Segoe Script", "Lucida Handwriting", "Brush Script MT", cursive' },
  { label: 'Zarif', css: 'italic 50px "Palatino Linotype", "Book Antiqua", Georgia, serif' },
  { label: 'Düz', css: '46px "Segoe UI", Arial, sans-serif' },
];

export async function openSignatureDialog(ctx) {
  const saved = (await ctx.api.getSetting('signatures', [])) || [];
  let mode = 'draw';
  let strokes = [];
  let imageData = null;
  let chosenSaved = null;
  let color = '#10204a';

  const pad = el('canvas', { class: 'sig-pad', width: PAD_W * 2, height: PAD_H * 2 });
  const pctx = pad.getContext('2d');
  const typedInput = el('input', { type: 'text', placeholder: 'Adınızı yazın', value: ctx.state.prefs.author || '' });
  const fontSelect = el('select', {}, TYPE_FONTS.map((f, i) => el('option', { value: i }, f.label)));
  const typedPreview = el('div', { class: 'sig-typed' });
  const imgPreview = el('div', { class: 'sig-typed', style: { fontSize: '14px', color: 'var(--muted)' } }, 'Bir resim seçin (PNG/JPG). Beyaz arka plan otomatik olarak temizlenir.');
  const saveChk = el('input', { type: 'checkbox', checked: true });
  const colorInputs = ['#10204a', '#000000', '#1d4ed8'].map((c) => {
    const b = el('button', { type: 'button', class: `swatch${c === color ? ' active' : ''}`, style: { background: c } });
    b.addEventListener('click', () => {
      color = c;
      colorInputs.forEach((x) => x.classList.toggle('active', x === b));
      redraw();
      updateTyped();
    });
    return b;
  });

  // ----- draw pad
  function redraw() {
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.lineCap = 'round';
    pctx.lineJoin = 'round';
    pctx.strokeStyle = color;
    pctx.lineWidth = 5;
    for (const s of strokes) {
      pctx.beginPath();
      s.forEach(([x, y], i) => (i ? pctx.lineTo(x, y) : pctx.moveTo(x, y)));
      if (s.length === 1) pctx.lineTo(s[0][0] + 0.1, s[0][1]);
      pctx.stroke();
    }
  }
  let drawing = null;
  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height];
  };
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    drawing = [pos(e)];
    strokes.push(drawing);
    redraw();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.push(pos(e));
    redraw();
  });
  pad.addEventListener('pointerup', () => { drawing = null; });

  function updateTyped() {
    typedPreview.textContent = typedInput.value || ' ';
    typedPreview.style.font = TYPE_FONTS[fontSelect.value].css;
    typedPreview.style.color = color;
  }
  typedInput.addEventListener('input', updateTyped);
  fontSelect.addEventListener('change', updateTyped);
  updateTyped();

  const pickBtn = el('button', { type: 'button', class: 'btn' }, 'Resim seç…');
  pickBtn.addEventListener('click', async () => {
    const [p] = await ctx.api.openDialog({ title: 'İmza resmi', filters: [{ name: 'Resimler', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }] });
    if (!p) return;
    const { data } = await ctx.api.readFile(p);
    const bitmap = await createImageBitmap(new Blob([data]));
    imageData = removeWhite(bitmap);
    const img = el('img', { src: imageData.toDataURL('image/png'), style: { maxHeight: '180px', maxWidth: '540px' } });
    imgPreview.replaceChildren(img);
  });

  // ----- tabs
  const panels = {
    draw: el('div', {}, pad, el('div', { class: 'radio-row' },
      el('span', { class: 'muted' }, 'Renk:'), colorInputs,
      el('span', { style: { flex: 1 } }),
      el('button', { type: 'button', class: 'btn', onclick: () => { strokes = []; redraw(); } }, 'Temizle'))),
    type: el('div', {}, el('div', { class: 'radio-row' }, typedInput, fontSelect), typedPreview),
    image: el('div', {}, el('div', { class: 'radio-row' }, pickBtn), imgPreview),
  };
  const tabBtns = [['draw', 'Çiz'], ['type', 'Yaz'], ['image', 'Resim']].map(([k, label]) => {
    const b = el('button', { type: 'button', class: k === mode ? 'active' : '' }, label);
    b.addEventListener('click', () => {
      mode = k;
      tabBtns.forEach((x) => x.classList.toggle('active', x === b));
      Object.entries(panels).forEach(([pk, p]) => { p.hidden = pk !== k; });
    });
    return b;
  });
  Object.entries(panels).forEach(([pk, p]) => { p.hidden = pk !== mode; });

  const savedBox = el('div', { class: 'sig-saved' });
  let resolveSaved = null;
  function renderSaved() {
    savedBox.replaceChildren();
    saved.forEach((url, i) => {
      const del = el('button', { type: 'button', class: 'sig-del', title: 'Sil' }, icon('close'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        saved.splice(i, 1);
        ctx.api.setSetting('signatures', saved);
        renderSaved();
      });
      const item = el('div', { class: 'sig-item', title: 'Bu imzayı kullan' }, el('img', { src: url }), del);
      item.addEventListener('click', () => {
        chosenSaved = url;
        resolveSaved?.();
      });
      savedBox.append(item);
    });
  }
  renderSaved();

  const body = el('div', {},
    saved.length ? el('div', { class: 'form-row' }, el('span', {}, 'Kayıtlı imzalar (kullanmak için tıklayın)'), savedBox) : null,
    el('div', { class: 'sig-tabs' }, tabBtns),
    panels.draw, panels.type, panels.image,
    el('label', { class: 'radio-row' }, saveChk, 'Bu imzayı sonraki kullanımlar için kaydet'));

  const result = await showDialog({
    title: 'İmza oluştur',
    body,
    width: 620,
    onOpen: () => {
      resolveSaved = () => $dialogClose();
    },
    buttons: [
      { label: 'İptal', value: null },
      {
        label: 'İmzayı yerleştir',
        primary: true,
        value: () => {
          let canvas = null;
          if (mode === 'draw' && strokes.length) canvas = trim(pad);
          if (mode === 'type' && typedInput.value.trim()) canvas = renderTyped(typedInput.value.trim(), TYPE_FONTS[fontSelect.value].css, color);
          if (mode === 'image' && imageData) canvas = trim(imageData);
          if (!canvas) return null;
          const url = canvas.toDataURL('image/png');
          if (saveChk.checked && !saved.includes(url)) {
            saved.unshift(url);
            ctx.api.setSetting('signatures', saved.slice(0, 6));
          }
          return url;
        },
      },
    ],
  });

  const url = chosenSaved || result;
  if (!url) return null;
  return (await fetch(url)).blob();
}

function $dialogClose() {
  document.getElementById('dialog').close();
}

function renderTyped(text, font, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const scale = 3;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w * scale;
  c.height = 110 * scale;
  g.scale(scale, scale);
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 20, 55);
  return trim(c);
}

// Makes near-white pixels transparent (for scanned/photographed signatures).
function removeWhite(bitmap) {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (lum > 225) d[i + 3] = 0;
    else if (lum > 180) d[i + 3] = Math.round(d[i + 3] * (225 - lum) / 45);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Crops transparent margins.
function trim(src) {
  const g = src.getContext('2d');
  const { width, height } = src;
  const d = g.getImageData(0, 0, width, height).data;
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
