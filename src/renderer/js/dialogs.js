// Feature dialogs: properties, preferences, merge, split, extract, export, shortcuts, about.

import { el, icon, showDialog, toast, busy, parsePageRanges, formatBytes, basename } from './ui.js';

function row(label, input) {
  return el('label', { class: 'form-row' }, el('span', {}, label), input);
}

function pdfDate(s) {
  if (!s) return '';
  const d = globalThis.pdfjsLib?.PDFDateString?.toDateObject(s);
  return d ? d.toLocaleString('tr-TR') : s;
}

// ---------------------------------------------------------------- properties
export async function properties(ctx) {
  const { state, pdfViewer } = ctx;
  const doc = state.pdfDoc;
  const { info, metadata } = await doc.getMetadata().catch(() => ({ info: {} }));
  const page = await doc.getPage(pdfViewer.currentPageNumber);
  const [x0, y0, x1, y1] = page.view;
  const mm = (pt) => Math.round((pt / 72) * 25.4);
  const title = el('input', { type: 'text', value: metadata?.get('dc:title') || info.Title || '' });
  const author = el('input', { type: 'text', value: metadata?.get('dc:creator')?.join?.(', ') || info.Author || '' });
  const subject = el('input', { type: 'text', value: info.Subject || '' });
  const keywords = el('input', { type: 'text', value: info.Keywords || '' });
  const table = el('table', { class: 'props' },
    [
      ['Dosya', state.filePath || state.fileName],
      ['Dosya boyutu', formatBytes(state.fileSize)],
      ['Sayfa sayısı', String(doc.numPages)],
      ['Sayfa boyutu', `${mm(x1 - x0)} × ${mm(y1 - y0)} mm (${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} pt)`],
      ['PDF sürümü', info.PDFFormatVersion || ''],
      ['Oluşturan uygulama', info.Creator || ''],
      ['PDF üreticisi', info.Producer || ''],
      ['Oluşturulma', pdfDate(info.CreationDate)],
      ['Değiştirilme', pdfDate(info.ModDate)],
      ['Hızlı web görünümü', info.IsLinearized ? 'Evet' : 'Hayır'],
      ['Form', info.IsAcroFormPresent ? 'AcroForm' : info.IsXFAPresent ? 'XFA' : 'Yok'],
    ].map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v))));

  const res = await showDialog({
    title: 'Belge özellikleri',
    width: 620,
    body: el('div', {}, row('Başlık', title), row('Yazar', author), row('Konu', subject), row('Anahtar sözcükler', keywords), table),
    buttons: [
      { label: 'Kapat', value: null },
      { label: 'Bilgileri güncelle', value: true, primary: true },
    ],
  });
  if (res) {
    await ctx.applyOp('Belge bilgileri', 'setMetadata', {
      title: title.value, author: author.value, subject: subject.value, keywords: keywords.value,
    });
  }
}

// ---------------------------------------------------------------- preferences
export async function preferences(ctx) {
  const p = ctx.state.prefs;
  const theme = el('select', {},
    [['system', 'Sistem ayarını izle'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, l]) => el('option', { value: v, selected: p.theme === v }, l)));
  const zoom = el('select', {},
    [['auto', 'Otomatik'], ['page-fit', 'Sayfaya sığdır'], ['page-width', 'Genişliğe sığdır'], ['page-actual', 'Gerçek boyut'], ['1', '%100'], ['1.25', '%125'], ['1.5', '%150']]
      .map(([v, l]) => el('option', { value: v, selected: p.defaultZoom === v }, l)));
  const author = el('input', { type: 'text', value: p.author || '', placeholder: 'Notlarda ve imzada görünecek ad' });
  return showDialog({
    title: 'Tercihler',
    body: el('div', {}, row('Tema', theme), row('Varsayılan yakınlaştırma', zoom), row('Yazar adı', author)),
    buttons: [
      { label: 'İptal', value: null },
      { label: 'Kaydet', primary: true, value: () => ({ theme: theme.value, defaultZoom: zoom.value, author: author.value.trim() }) },
    ],
  });
}

// ---------------------------------------------------------------- merge
export async function merge(ctx) {
  const { api } = ctx;
  const files = [];
  if (ctx.state.filePath && !ctx.state.dirty) files.push(ctx.state.filePath);
  const list = el('ul', { class: 'merge-list' });

  function render() {
    list.replaceChildren();
    if (!files.length) list.append(el('li', { class: 'muted' }, 'Henüz dosya eklenmedi.'));
    files.forEach((f, i) => {
      const up = el('button', { type: 'button', class: 'tb small', title: 'Yukarı' }, icon('prev'));
      const down = el('button', { type: 'button', class: 'tb small', title: 'Aşağı' }, icon('next'));
      const rm = el('button', { type: 'button', class: 'tb small', title: 'Kaldır' }, icon('close'));
      up.disabled = i === 0;
      down.disabled = i === files.length - 1;
      up.addEventListener('click', () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; render(); });
      down.addEventListener('click', () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; render(); });
      rm.addEventListener('click', () => { files.splice(i, 1); render(); });
      list.append(el('li', {}, el('span', { title: f }, `${i + 1}. ${basename(f)}`), up, down, rm));
    });
  }
  const add = el('button', { type: 'button', class: 'btn' }, icon('open'), 'Dosya ekle…');
  add.addEventListener('click', async () => {
    const picked = await api.openDialog({ title: 'Birleştirilecek PDF dosyaları', multi: true });
    files.push(...picked);
    render();
  });
  render();

  const ok = await showDialog({
    title: 'Dosyaları birleştir',
    width: 560,
    body: el('div', {}, el('p', { class: 'muted' }, 'Dosyaları ekleyin ve sırasını belirleyin. Sonuç yeni bir PDF olarak kaydedilir.'), list, el('div', { class: 'radio-row' }, add)),
    buttons: [
      { label: 'İptal', value: false },
      {
        label: 'Birleştir',
        primary: true,
        value: true,
        validate: () => {
          if (files.length < 2) { toast('En az iki dosya ekleyin.'); return false; }
          return true;
        },
      },
    ],
  });
  if (!ok) return;
  try {
    const out = await busy('Birleştiriliyor…', async () => {
      const datas = [];
      for (const f of files) datas.push((await api.readFile(f)).data);
      return api.pdfOp('merge', { files: datas });
    });
    const target = await ctx.saveBytesAs(out, 'Birlestirilmis.pdf');
    if (target) {
      toast('Dosyalar birleştirildi.');
      await ctx.openPath(target);
    }
  } catch (err) {
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true });
  }
}

// ---------------------------------------------------------------- split
export async function split(ctx) {
  const { api, state } = ctx;
  const n = state.pdfDoc.numPages;
  const mk = (value, label, checked) => {
    const r = el('input', { type: 'radio', name: 'splitmode', value, checked });
    return [r, el('label', { class: 'radio-row' }, r, label)];
  };
  const [rEvery, lEvery] = mk('every', 'Her ', true);
  const everyN = el('input', { type: 'number', min: 1, max: n, value: 1, style: { width: '64px' } });
  lEvery.append(everyN, ' sayfada bir yeni dosya');
  const [rRanges, lRanges] = mk('ranges', 'Aralıklara göre: ', false);
  const ranges = el('input', { type: 'text', placeholder: 'ör. 1-3; 4-10; 11-', style: { flex: 1 } });
  lRanges.append(ranges);
  ranges.addEventListener('focus', () => { rRanges.checked = true; });
  everyN.addEventListener('focus', () => { rEvery.checked = true; });

  const res = await showDialog({
    title: 'Belgeyi böl',
    width: 520,
    body: el('div', {}, el('p', { class: 'muted' }, `Belgede ${n} sayfa var. Her parça ayrı bir PDF dosyası olarak seçeceğiniz klasöre kaydedilir.`), lEvery, lRanges,
      el('p', { class: 'muted small' }, 'Aralıkları noktalı virgülle ayırın. Her aralık bir dosya olur; "1-3, 5" gibi virgüllü listeler aynı dosyaya girer.')),
    buttons: [
      { label: 'İptal', value: null },
      {
        label: 'Böl',
        primary: true,
        value: () => {
          if (rEvery.checked) {
            const k = Math.max(1, parseInt(everyN.value, 10) || 1);
            const groups = [];
            for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map((j) => i + j));
            return groups;
          }
          return ranges.value.split(';').map((s) => parsePageRanges(s, n));
        },
        validate: () => {
          if (rEvery.checked) return true;
          const parts = ranges.value.split(';').filter((s) => s.trim());
          const ok = parts.length && parts.every((s) => parsePageRanges(s, n));
          if (!ok) toast('Geçersiz aralık. Örnek: 1-3; 4-10; 11-');
          return !!ok;
        },
      },
    ],
  });
  if (!res) return;
  const groups = res.filter((g) => g && g.length);
  const dir = await api.chooseDir({ title: 'Parçaların kaydedileceği klasör' });
  if (!dir) return;
  try {
    const written = await busy('Bölünüyor…', async () => {
      const bytes = await ctx.getCurrentBytes();
      const outs = await api.pdfOp('split', { bytes, ranges: groups });
      const sep = dir.includes('\\') ? '\\' : '/';
      const pad = String(outs.length).length;
      const paths = [];
      for (let i = 0; i < outs.length; i++) {
        const p = `${dir}${sep}${ctx.docBaseName()}_bolum${String(i + 1).padStart(pad, '0')}.pdf`;
        await api.writeFile(p, outs[i]);
        paths.push(p);
      }
      return paths;
    });
    toast(`${written.length} dosya oluşturuldu.`);
    api.showInFolder(written[0]);
  } catch (err) {
    toast(String(err.message || err), { error: true });
  }
}

// ---------------------------------------------------------------- extract
export async function extract(ctx) {
  const n = ctx.state.pdfDoc.numPages;
  const input = el('input', { type: 'text', value: String(ctx.pdfViewer.currentPageNumber) });
  const del = el('input', { type: 'checkbox' });
  const res = await showDialog({
    title: 'Sayfaları ayıkla',
    body: el('div', {}, row(`Sayfalar (1-${n}), ör. 1-3, 7`, input), el('label', { class: 'radio-row' }, del, 'Ayıklanan sayfaları bu belgeden sil')),
    buttons: [
      { label: 'İptal', value: null },
      {
        label: 'Ayıkla',
        primary: true,
        value: () => parsePageRanges(input.value, n),
        validate: () => {
          const ok = parsePageRanges(input.value, n);
          if (!ok) toast('Geçersiz sayfa aralığı.');
          return !!ok;
        },
      },
    ],
  });
  if (!res) return;
  const pages = [...new Set(res)];
  const bytes = await ctx.getCurrentBytes();
  const out = await ctx.api.pdfOp('extract', { bytes, pages });
  const target = await ctx.saveBytesAs(out, `${ctx.docBaseName()}_ayiklanan.pdf`);
  if (!target) return;
  toast(`${pages.length} sayfa kaydedildi.`);
  if (del.checked) await ctx.applyOp('Sayfa silme', 'remove', { pages });
}

// ---------------------------------------------------------------- images -> PDF
export async function imagesToPdf(ctx) {
  const { api } = ctx;
  const picked = await api.openDialog({ title: 'PDF\'e dönüştürülecek resimler', multi: true, filters: [{ name: 'Resimler', extensions: ['png', 'jpg', 'jpeg'] }] });
  if (!picked.length) return;
  try {
    const out = await busy('PDF oluşturuluyor…', async () => {
      const images = [];
      for (const p of picked) images.push((await api.readFile(p)).data);
      return api.pdfOp('imagesToPdf', { images });
    });
    const target = await ctx.saveBytesAs(out, 'Resimler.pdf');
    if (target) await ctx.openPath(target);
  } catch (err) {
    toast(String(err.message || err), { error: true });
  }
}

// ---------------------------------------------------------------- export pages as images
export async function exportImages(ctx) {
  const n = ctx.state.pdfDoc.numPages;
  const pages = el('input', { type: 'text', value: `1-${n}` });
  const dpi = el('select', {}, [72, 96, 150, 200, 300].map((v) => el('option', { value: v, selected: v === 150 }, `${v} DPI`)));
  const fmt = el('select', {}, el('option', { value: 'png' }, 'PNG'), el('option', { value: 'jpeg' }, 'JPEG'));
  const res = await showDialog({
    title: 'Sayfaları resim olarak dışa aktar',
    body: el('div', {}, row('Sayfalar', pages), row('Çözünürlük', dpi), row('Biçim', fmt)),
    buttons: [
      { label: 'İptal', value: null },
      {
        label: 'Dışa aktar',
        primary: true,
        value: () => ({ list: parsePageRanges(pages.value, n), dpi: Number(dpi.value), fmt: fmt.value }),
        validate: () => !!parsePageRanges(pages.value, n) || (toast('Geçersiz sayfa aralığı.'), false),
      },
    ],
  });
  if (!res) return;
  const dir = await ctx.api.chooseDir({ title: 'Resimlerin kaydedileceği klasör' });
  if (!dir) return;
  const sep = dir.includes('\\') ? '\\' : '/';
  let first = null;
  await busy('Dışa aktarılıyor…', async () => {
    for (const i of res.list) {
      document.getElementById('busyText').textContent = `Dışa aktarılıyor… sayfa ${i + 1}`;
      const canvas = await ctx.renderPageToCanvas(i, { scale: res.dpi / 72 });
      const blob = await new Promise((r) => canvas.toBlob(r, `image/${res.fmt}`, 0.92));
      const p = `${dir}${sep}${ctx.docBaseName()}_s${i + 1}.${res.fmt === 'jpeg' ? 'jpg' : 'png'}`;
      await ctx.api.writeFile(p, new Uint8Array(await blob.arrayBuffer()));
      first = first || p;
    }
  });
  toast(`${res.list.length} resim kaydedildi.`);
  if (first) ctx.api.showInFolder(first);
}

// ---------------------------------------------------------------- shortcuts / about
export function shortcuts() {
  const rows = [
    ['Ctrl+O', 'Dosya aç'], ['Ctrl+S', 'Kaydet'], ['Ctrl+Shift+S', 'Farklı kaydet'], ['Ctrl+P', 'Yazdır'],
    ['Ctrl+W', 'Belgeyi kapat'], ['Ctrl+N', 'Yeni pencere'], ['Ctrl+Z / Ctrl+Y', 'Geri al / Yinele'],
    ['Ctrl+F, F3, Shift+F3', 'Bul, sonraki, önceki'], ['Ctrl+G', 'Sayfaya git'],
    ['Ctrl+= / Ctrl+-', 'Yakınlaştır / Uzaklaştır'], ['Ctrl+Tekerlek', 'Yakınlaştır / Uzaklaştır'],
    ['Ctrl+0 / Ctrl+1 / Ctrl+2', 'Sayfaya sığdır / Gerçek boyut / Genişliğe sığdır'],
    ['Ctrl+L', 'Tam ekran okuma (Esc ile çık)'], ['F4', 'Kenar çubuğu'], ['Ctrl+D', 'Belge özellikleri'],
    ['Ctrl+Shift+O', 'Sayfaları düzenle'], ['Home / End', 'İlk / son sayfa'],
    ['V', 'Metin seçimi'], ['H', 'El aracı'], ['U', 'Vurgula'], ['T', 'Metin ekle'], ['D', 'Serbest çizim'], ['N', 'Yapışkan not'],
    ['Delete', 'Seçili açıklamayı / sayfayı sil'],
  ];
  return showDialog({
    title: 'Klavye kısayolları',
    width: 520,
    body: el('table', { class: 'props kbd-table' }, rows.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v)))),
  });
}

export async function about(ctx) {
  const info = await ctx.api.info();
  return showDialog({
    title: 'Katip PDF hakkında',
    body: el('div', {},
      el('p', {}, el('strong', {}, `Katip PDF ${info.version}`), ` (${info.arch})`),
      el('p', {}, 'Windows için PDF okuyucu ve düzenleyici.'),
      el('p', { class: 'muted small' }, 'Açık kaynak bileşenler: Electron (MIT), PDF.js (Apache 2.0), pdf-lib (MIT), fontkit (MIT), DejaVu Sans yazı tipi (Bitstream Vera lisansı).')),
  });
}
