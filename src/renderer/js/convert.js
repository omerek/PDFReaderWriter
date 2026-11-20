// PDF <-> Word conversion and 3D model handling (desktop only; on Android the bridge has no such calls).

import { el, toast, busy, showDialog, parsePageRanges } from './ui.js';

export const canConvert = (api) => !!api.pdfToDocx;

function setBusyText(t) {
  const b = document.getElementById('busyText');
  if (b) b.textContent = t;
}

/** Text items of one page in PDF coordinates (y grows upward), plus real font names. */
async function pageText(page) {
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent({ includeMarkedContent: false });
  // Loading the operator list makes the font objects (with their real names) available.
  try { await page.getOperatorList(); } catch { /* fonts stay unknown */ }
  const fontInfo = {};
  const info = (id) => {
    if (id in fontInfo) return fontInfo[id];
    let f = null;
    try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch { /* ignore */ }
    fontInfo[id] = {
      name: f?.name || tc.styles[id]?.fontFamily || '',
      bold: !!(f?.bold || f?.black),
      italic: !!f?.italic,
    };
    return fontInfo[id];
  };
  // Undo the page rotation / crop box offset so x,y are in the unrotated page space.
  const [vx, vy] = [viewport.viewBox[0], viewport.viewBox[1]];
  const items = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    const fi = info(it.fontName);
    items.push({ str: it.str, x: e - vx, y: f - vy, w: it.width, size, font: fi.name, bold: fi.bold, italic: fi.italic });
  }
  return { width: viewport.viewBox[2] - vx, height: viewport.viewBox[3] - vy, items };
}

/** Extracts the given pages (0-based) and builds the .docx bytes in the main process. */
export async function buildDocx(ctx, list, scanned = true) {
  const { api, state } = ctx;
  const n = state.pdfDoc.numPages;
  const pages = [];
  let textless = 0;
  for (const i of list) {
    setBusyText(`Word'e dönüştürülüyor… sayfa ${i + 1} / ${n}`);
    const page = await state.pdfDoc.getPage(i + 1);
    const pg = await pageText(page);
    if (!pg.items.some((it) => it.str.trim())) {
      pg.items = [];
      textless++;
      if (scanned) {
        const canvas = await ctx.renderPageToCanvas(i, { scale: 150 / 72 });
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        pg.image = new Uint8Array(await blob.arrayBuffer());
      }
    }
    pages.push(pg);
  }
  const docx = await api.pdfToDocx({ pages, title: ctx.docBaseName() });
  return { docx, textless };
}

export async function pdfToWord(ctx) {
  const { api, state } = ctx;
  if (!state.pdfDoc || !canConvert(api)) return;
  const n = state.pdfDoc.numPages;
  const pagesInput = el('input', { type: 'text', value: `1-${n}` });
  const scanned = el('input', { type: 'checkbox', checked: true });
  const res = await showDialog({
    title: 'PDF\'yi Word\'e dönüştür',
    body: el('div', {},
      el('label', { class: 'form-row' }, el('span', {}, 'Sayfalar'), pagesInput),
      el('label', { class: 'form-row' }, el('span', {}, 'Metni olmayan sayfalar'),
        el('span', {}, scanned, ' resim olarak eklensin (taranmış belgeler)')),
      el('p', { class: 'hint' }, 'Metin, yazı tipi boyutu, kalın/italik ve paragraflar aktarılır. Tablolar sekmeli metin olur; karmaşık sayfa düzenleri birebir korunmayabilir.')),
    buttons: [
      { label: 'İptal', value: null },
      {
        label: 'Dönüştür',
        primary: true,
        value: () => ({ list: parsePageRanges(pagesInput.value, n), scanned: scanned.checked }),
        validate: () => !!parsePageRanges(pagesInput.value, n) || (toast('Geçersiz sayfa aralığı.'), false),
      },
    ],
  });
  if (!res) return;
  const target = await api.saveDialog({
    title: 'Word belgesi olarak kaydet',
    defaultPath: `${ctx.docBaseName()}.docx`,
    filters: [{ name: 'Word Belgesi', extensions: ['docx'] }],
  });
  if (!target) return;
  try {
    let textless = 0;
    await busy("Word'e dönüştürülüyor…", async () => {
      const out = await buildDocx(ctx, res.list, res.scanned);
      textless = out.textless;
      await api.writeFile(target, out.docx);
    });
    toast(textless && textless === res.list.length
      ? 'Kaydedildi. Belgede seçilebilir metin yok (taranmış); sayfalar resim olarak eklendi.'
      : 'Word belgesi kaydedildi.', { timeout: 5000 });
    api.showInFolder(target);
  } catch (err) {
    toast(`Dönüştürülemedi: ${err.message || err}`, { error: true });
  }
}

/** Converts a .docx file to PDF and opens the result as a new, unsaved document. */
export async function wordToPdf(ctx, filePath) {
  const { api } = ctx;
  if (!canConvert(api)) return;
  let p = filePath;
  if (!p) {
    [p] = await api.openDialog({ title: 'PDF\'ye dönüştürülecek Word belgesi', filters: [{ name: 'Word Belgesi', extensions: ['docx'] }] });
  }
  if (!p) return;
  if (!(await ctx.confirmDiscard())) return;
  try {
    const pdf = await busy('PDF\'ye dönüştürülüyor…', async () => {
      const { data } = await api.readFile(p);
      return api.docxToPdf(data);
    });
    const name = p.split(/[\\/]/).pop().replace(/\.docx$/i, '') || 'Belge';
    ctx.state.password = null;
    await ctx.loadBytes(pdf, { fileName: `${name}.pdf`, fresh: true, untitled: true });
    toast('Word belgesi PDF\'ye dönüştürüldü. Kaydetmek için Ctrl+S.', { timeout: 5000 });
  } catch (err) {
    toast(`Dönüştürülemedi: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { error: true });
  }
}

// ---------------------------------------------------------------- 3D
const FORMAT_INFO = {
  U3D: { ext: 'u3d', name: 'U3D modeli' },
  PRC: { ext: 'prc', name: 'PRC modeli' },
};

/** After a document opens: tell the user when it holds 3D models pdf.js cannot display. */
export async function check3D(ctx, bytes) {
  const { api, state } = ctx;
  const banner = document.getElementById('banner3d');
  if (banner) banner.hidden = true;
  state.models3D = [];
  if (!api.find3D) return;
  const models = await api.find3D(bytes, false).catch(() => []);
  state.models3D = models;
  if (!models.length || !banner) return;
  const pagesList = [...new Set(models.map((m) => m.page + 1))].join(', ');
  banner.querySelector('.b3d-text').textContent = `Bu belgede ${models.length} adet 3B model var (${[...new Set(models.map((m) => m.format))].join('/')}, sayfa ${pagesList}). `
    + 'Katip PDF 3B modeli döndürüp inceleyemez; sayfada modelin önizleme resmi görünür. Modeli dosya olarak dışa aktarıp bir 3B görüntüleyicide açabilirsiniz.';
  banner.hidden = false;
}

export async function export3D(ctx) {
  const { api, state } = ctx;
  if (!state.pdfDoc || !api.find3D) return;
  try {
    const bytes = await ctx.getCurrentBytes();
    const models = await busy('3B modeller aranıyor…', () => api.find3D(bytes, true));
    if (!models.length) {
      toast('Bu belgede 3B model yok.');
      return;
    }
    let first = null;
    for (const [i, m] of models.entries()) {
      const fi = FORMAT_INFO[m.format] || { ext: m.format.toLowerCase() || 'bin', name: '3B model' };
      const suffix = models.length > 1 ? `_3B_${i + 1}` : '_3B';
      const target = await api.saveDialog({
        title: `${fi.name} kaydet (sayfa ${m.page + 1})`,
        defaultPath: `${ctx.docBaseName()}${suffix}.${fi.ext}`,
        filters: [{ name: fi.name, extensions: [fi.ext] }],
      });
      if (!target) continue;
      await api.writeFile(target, m.data);
      first = first || target;
    }
    if (first) {
      toast('3B model kaydedildi.');
      api.showInFolder(first);
    }
  } catch (err) {
    toast(`3B model dışa aktarılamadı: ${err.message || err}`, { error: true });
  }
}
