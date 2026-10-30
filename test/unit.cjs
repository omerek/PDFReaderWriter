// Unit tests for the pdf-lib based operations (no Electron needed).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PDFDocument, PDFName } = require('pdf-lib');
const ops = require('../src/main/pdfops');

const fx = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const pages = async (b) => (await PDFDocument.load(b)).getPageCount();
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('OK   ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n     ', e.stack); }
}

(async () => {
  const doc = fx('ornek.pdf');
  const ek = fx('ek.pdf');
  await t('rotate', async () => {
    const out = await ops.run('rotate', { bytes: doc, pages: [0, 2], delta: -90 });
    const d = await PDFDocument.load(out);
    assert.deepStrictEqual(d.getPages().map((p) => p.getRotation().angle), [270, 0, 270, 0, 0]);
  });
  await t('remove + guard', async () => {
    assert.strictEqual(await pages(await ops.run('remove', { bytes: doc, pages: [1, 3] })), 3);
    await assert.rejects(ops.run('remove', { bytes: doc, pages: [0, 1, 2, 3, 4] }), /en az bir sayfa/);
  });
  await t('reorder', async () => {
    const out = await ops.run('reorder', { bytes: doc, order: [4, 0, 1, 2, 3] });
    assert.strictEqual(await pages(out), 5);
    await assert.rejects(ops.run('reorder', { bytes: doc, order: [0, 0, 1, 2, 3] }), /Geçersiz/);
  });
  await t('insertBlank / insertFile / duplicate', async () => {
    assert.strictEqual(await pages(await ops.run('insertBlank', { bytes: doc, at: 2, count: 2 })), 7);
    assert.strictEqual(await pages(await ops.run('insertFile', { bytes: doc, at: 0, other: ek })), 7);
    assert.strictEqual(await pages(await ops.run('duplicate', { bytes: doc, pages: [0, 4] })), 7);
  });
  await t('extract / merge / split', async () => {
    assert.strictEqual(await pages(await ops.run('extract', { bytes: doc, pages: [1, 2] })), 2);
    assert.strictEqual(await pages(await ops.run('merge', { files: [doc, ek, ek] })), 9);
    const parts = await ops.run('split', { bytes: doc, ranges: [[0, 1], [2], [3, 4]] });
    assert.deepStrictEqual(await Promise.all(parts.map(pages)), [2, 1, 2]);
  });
  await t('addNote', async () => {
    const out = await ops.run('addNote', { bytes: doc, page: 0, x: 100, y: 700, text: 'Şişli notu', author: 'Ömer' });
    const d = await PDFDocument.load(out);
    const a = d.getPage(0).node.Annots().lookup(0);
    assert.strictEqual(String(a.get(PDFName.of('Subtype'))), '/Text');
    assert.strictEqual(a.lookup(PDFName.of('Contents')).decodeText(), 'Şişli notu');
  });
  await t('addText (Unicode font)', async () => {
    const out = await ops.run('addText', { bytes: doc, page: 0, x: 72, y: 100, text: 'İğdır ŞĞÜ' });
    assert.ok(out.length > doc.length);
  });
  await t('setMetadata', async () => {
    const out = await ops.run('setMetadata', { bytes: doc, title: 'Başlık ğ', author: 'Ömer' });
    const d = await PDFDocument.load(out);
    assert.strictEqual(d.getTitle(), 'Başlık ğ');
  });
  await t('flattenForm', async () => {
    const out = await ops.run('flattenForm', { bytes: fx('form.pdf') });
    assert.strictEqual((await PDFDocument.load(out)).getForm().getFields().length, 0);
    await assert.rejects(ops.run('flattenForm', { bytes: doc }), /form alanı yok/);
  });
  await t('fixAppearances: no-op without Turkish text', async () => {
    const out = await ops.run('fixAppearances', { bytes: doc });
    assert.strictEqual(out, doc);
  });
  await t('fixAppearances: form field with ş/İ', async () => {
    const d = await PDFDocument.load(fx('form.pdf'));
    d.getForm().getTextField('adsoyad').setText('Ayşe');
    d.getForm().getDropdown('sehir').select('İzmir');
    const b = await d.save({ updateFieldAppearances: false });
    const out = await ops.run('fixAppearances', { bytes: b });
    assert.notStrictEqual(out, b);
    const f = (await PDFDocument.load(out)).getForm();
    assert.strictEqual(f.getTextField('adsoyad').getText(), 'Ayşe');
  });
  await t('imagesToPdf', async () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png'));
    assert.strictEqual(await pages(await ops.run('imagesToPdf', { images: [png, png] })), 2);
  });
  await t('encrypted / invalid input gives readable error', async () => {
    await assert.rejects(ops.run('rotate', { bytes: new Uint8Array([1, 2, 3]), pages: [0], delta: 90 }), /PDF okunamadı/);
  });
  // ---- original text editing
  const textedit = require('../src/main/textedit');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const textItems = async (b) => {
    const d = await pdfjs.getDocument({ data: b.slice(), verbosity: 0, standardFontDataUrl: path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep }).promise;
    return (await (await d.getPage(1)).getTextContent()).items.filter((i) => i.str.trim());
  };
  await t('parseContent: strings, arrays, inline images', async () => {
    const src = 'BT /F1 12 Tf (a\\(b\\)c \\303) Tj [(x) -250 <0041>] TJ ET BI /W 1 /H 1 ID \x00\xffEI Q EI q 1 0 0 1 5 5 cm Q';
    const ops = textedit.parseContent(src).map((o) => o.op);
    assert.deepStrictEqual(ops, ['BT', 'Tf', 'Tj', 'TJ', 'ET', 'BI', 'q', 'cm', 'Q']);
    const tj = textedit.parseContent(src)[2];
    assert.deepStrictEqual(tj.args[0].bytes, [97, 40, 98, 41, 99, 32, 0o303]);
  });
  for (const [file, needle, replacement] of [['chrome.pdf', 'Ahmet', 'Müşteri adı: Ayşe Güler'], ['ornek.pdf', 'Satır 3:', 'Yeni satır ğşı']]) {
    await t(`editText (${file}): old glyphs removed, other lines kept`, async () => {
      const bytes = fx(file);
      const before = await textItems(bytes);
      const it = before.find((i) => i.str.includes(needle));
      const out = await ops.run('editText', { bytes, page: 0, item: { transform: it.transform, width: it.width, height: it.height }, text: replacement, font: { family: 'sans' } });
      const after = (await textItems(out)).map((i) => i.str);
      assert.ok(!after.some((s) => s.includes(needle)), after.join('|'));
      assert.ok(after.some((s) => s.includes(replacement)), after.join('|'));
      assert.strictEqual(after.length, before.length, after.join('|'));
    });
  }
  await t('editText with empty text deletes the line', async () => {
    const bytes = fx('chrome.pdf');
    const it = (await textItems(bytes)).find((i) => i.str.includes('Toplam'));
    const out = await ops.run('editText', { bytes, page: 0, item: { transform: it.transform, width: it.width, height: it.height }, text: '' });
    const after = (await textItems(out)).map((i) => i.str).join('|');
    assert.ok(!after.includes('Toplam') && after.includes('Fatura Bilgileri'), after);
  });
  await t('addMarkup (underline / strike-out)', async () => {
    const q = [72, 700, 200, 700, 72, 688, 200, 688];
    for (const kind of ['Underline', 'StrikeOut']) {
      const out = await ops.run('addMarkup', { bytes: doc, page: 0, quads: [q], kind });
      const a = (await PDFDocument.load(out)).getPage(0).node.Annots().lookup(0);
      assert.strictEqual(String(a.get(PDFName.of('Subtype'))), `/${kind}`);
    }
  });

  console.log(failed ? `\n${failed} test başarısız` : '\nTüm birim testleri başarılı');
  process.exit(failed ? 1 : 0);
})();
