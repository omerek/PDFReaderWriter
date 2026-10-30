'use strict';

// Structural PDF operations (pages, merge, split, notes, metadata) done with pdf-lib.
// Every operation takes plain data (Uint8Array bytes + arguments) and returns new bytes,
// so the renderer can keep an undo history of whole documents.

const fs = require('fs');
const path = require('path');
const {
  PDFDocument, PDFName, PDFString, PDFArray, PDFHexString, degrees, rgb,
} = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const textedit = require('./textedit');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'DejaVuSans.ttf');
let fontBytes = null;
const fontFileCache = new Map();

// Metric-compatible stand-ins for the common PDF fonts (Arial/Helvetica, Times, Courier).
function editFontFile({ family = 'sans', bold = false, italic = false } = {}) {
  const base = { serif: 'LiberationSerif', mono: 'LiberationMono' }[family] || 'LiberationSans';
  const style = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const file = path.join(FONT_DIR, `${base}-${style}.ttf`);
  if (!fontFileCache.has(file)) fontFileCache.set(file, fs.readFileSync(file));
  return fontFileCache.get(file);
}

class OpError extends Error {}

async function load(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) {
      throw new OpError('Bu belge şifreli. Sayfa işlemleri için önce şifresiz bir kopyasını kaydedin.');
    }
    throw new OpError(`PDF okunamadı: ${err.message}`);
  }
}

async function save(doc) {
  const out = await doc.save({ useObjectStreams: true });
  return out;
}

function checkIndices(doc, pages) {
  const n = doc.getPageCount();
  for (const i of pages) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new OpError(`Geçersiz sayfa numarası: ${i + 1}`);
  }
}

const ops = {
  async rotate({ bytes, pages, delta }) {
    const doc = await load(bytes);
    checkIndices(doc, pages);
    for (const i of pages) {
      const page = doc.getPage(i);
      const cur = page.getRotation().angle || 0;
      page.setRotation(degrees((((cur + delta) % 360) + 360) % 360));
    }
    return save(doc);
  },

  async remove({ bytes, pages }) {
    const doc = await load(bytes);
    checkIndices(doc, pages);
    const unique = [...new Set(pages)].sort((a, b) => b - a);
    if (unique.length >= doc.getPageCount()) throw new OpError('Belgedeki tüm sayfalar silinemez; en az bir sayfa kalmalı.');
    for (const i of unique) doc.removePage(i);
    return save(doc);
  },

  // order: array of original page indices in their new order (a permutation).
  async reorder({ bytes, order }) {
    const doc = await load(bytes);
    const n = doc.getPageCount();
    if (order.length !== n || new Set(order).size !== n) throw new OpError('Geçersiz sayfa sırası.');
    checkIndices(doc, order);
    const pages = doc.getPages();
    for (let i = n - 1; i >= 0; i--) doc.removePage(i);
    order.forEach((src, i) => doc.insertPage(i, pages[src]));
    return save(doc);
  },

  async insertBlank({ bytes, at, count = 1 }) {
    const doc = await load(bytes);
    const n = doc.getPageCount();
    const ref = doc.getPage(Math.min(Math.max(at - 1, 0), n - 1));
    const { width, height } = ref.getSize();
    for (let k = 0; k < count; k++) doc.insertPage(Math.min(at + k, doc.getPageCount()), [width, height]);
    return save(doc);
  },

  async insertFile({ bytes, at, other }) {
    const doc = await load(bytes);
    const src = await load(other);
    const copied = await doc.copyPages(src, src.getPageIndices());
    copied.forEach((p, k) => doc.insertPage(Math.min(at + k, doc.getPageCount()), p));
    return save(doc);
  },

  async duplicate({ bytes, pages }) {
    const doc = await load(bytes);
    checkIndices(doc, pages);
    const sorted = [...new Set(pages)].sort((a, b) => b - a);
    for (const i of sorted) {
      const [copy] = await doc.copyPages(doc, [i]);
      doc.insertPage(i + 1, copy);
    }
    return save(doc);
  },

  async extract({ bytes, pages }) {
    const doc = await load(bytes);
    checkIndices(doc, pages);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(doc, pages);
    copied.forEach((p) => out.addPage(p));
    copyInfo(doc, out);
    return save(out);
  },

  async merge({ files }) {
    if (!files || files.length < 1) throw new OpError('Birleştirilecek dosya yok.');
    const out = await PDFDocument.create();
    for (const f of files) {
      const src = await load(f);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    return save(out);
  },

  // ranges: array of arrays of page indices; returns array of byte arrays.
  async split({ bytes, ranges }) {
    const doc = await load(bytes);
    const results = [];
    for (const r of ranges) {
      checkIndices(doc, r);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(doc, r);
      copied.forEach((p) => out.addPage(p));
      copyInfo(doc, out);
      results.push(await save(out));
    }
    return results;
  },

  // Sticky note (Text annotation). x/y are PDF user-space coordinates of the icon's top-left.
  async addNote({ bytes, page, x, y, text, author, color = [1, 0.82, 0.2] }) {
    const doc = await load(bytes);
    checkIndices(doc, [page]);
    const p = doc.getPage(page);
    const size = 22;
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [x, y - size, x + size, y],
      Contents: PDFHexString.fromText(text || ''),
      T: PDFHexString.fromText(author || ''),
      M: PDFString.fromDate(new Date()),
      Name: 'Comment',
      C: color,
      F: 4 | 8 | 16, // Print | NoZoom | NoRotate
      Open: false,
    });
    const ref = doc.context.register(annot);
    let annots = p.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = doc.context.obj([]);
      p.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
    return save(doc);
  },

  // Replaces one line of the page's original text. `item` is a pdf.js text item
  // ({ transform, width, height }) in PDF user space.
  async editText({ bytes, page, item, text, font, size, color = [0, 0, 0] }) {
    const doc = await load(bytes);
    checkIndices(doc, [page]);
    const p = doc.getPage(page);
    const [a, b, c, d, e, f] = item.transform;
    const len = (x, y) => Math.hypot(x, y) || 1;
    const u = [a / len(a, b), b / len(a, b)];
    const v = [c / len(c, d), d / len(c, d)];
    const height = item.height || len(c, d);
    const region = { origin: [e, f], u, v, width: item.width, height };

    const content = textedit.pageContent(p);
    const { content: edited, removed } = textedit.removeGlyphs(content, p.node.Resources(), region);
    if (removed) {
      textedit.setPageContent(p, edited);
    } else {
      // The text is not in the page's own content stream (e.g. inside a form XObject):
      // cover it instead.
      const pad = height * 0.15;
      const corner = [e - u[0] * pad - v[0] * height * 0.3, f - u[1] * pad - v[1] * height * 0.3];
      p.drawRectangle({
        x: corner[0], y: corner[1], width: item.width + 2 * pad, height: height * 1.35,
        rotate: degrees((Math.atan2(u[1], u[0]) * 180) / Math.PI), color: rgb(1, 1, 1),
      });
    }

    const value = String(text || '');
    if (value.trim()) {
      doc.registerFontkit(fontkit);
      const embedded = await doc.embedFont(editFontFile(font), { subset: true });
      p.drawText(value, {
        x: e, y: f, size: size || height, font: embedded, color: rgb(...color),
        rotate: degrees((Math.atan2(u[1], u[0]) * 180) / Math.PI),
      });
    }
    return save(doc);
  },

  // Underline / strike-out / highlight markup over a text selection.
  // quads: arrays of 8 numbers (x1 y1 x2 y2 x3 y3 x4 y4: top-left, top-right, bottom-left, bottom-right).
  async addMarkup({ bytes, page, quads, kind = 'Underline', color = [0, 0, 1], author = '', contents = '' }) {
    const doc = await load(bytes);
    checkIndices(doc, [page]);
    const p = doc.getPage(page);
    const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
    const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
    const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const n = (x) => (Math.round(x * 100) / 100).toString();
    const ops = [`${color.map(n).join(' ')} RG`];
    let resources;
    if (kind === 'Highlight') {
      // Filled quads blended with "multiply" so the text stays readable.
      resources = { ExtGState: { GS0: { BM: 'Multiply', CA: 1, ca: 1 } } };
      ops.splice(0, 1, '/GS0 gs', `${color.map(n).join(' ')} rg`);
      for (const q of quads) ops.push(`${n(q[0])} ${n(q[1])} m ${n(q[2])} ${n(q[3])} l ${n(q[6])} ${n(q[7])} l ${n(q[4])} ${n(q[5])} l f`);
    }
    for (const q of kind === 'Highlight' ? [] : quads) {
      const h = Math.abs(q[1] - q[5]);
      ops.push(`${n(Math.max(0.5, h / 14))} w`);
      // Bottom (underline) or middle (strike-out) of the quad.
      const k = kind === 'StrikeOut' ? 0.45 : 0.08;
      const y1 = q[5] + (q[1] - q[5]) * k;
      const y2 = q[7] + (q[3] - q[7]) * k;
      ops.push(`${n(q[4])} ${n(y1)} m ${n(q[6])} ${n(y2)} l S`);
    }
    const ap = doc.context.flateStream(ops.join('\n'), {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, ...(resources ? { Resources: resources } : {}),
    });
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: kind,
      Rect: rect,
      QuadPoints: quads.flat(),
      C: color,
      F: 4,
      T: PDFHexString.fromText(author),
      Contents: PDFHexString.fromText(contents),
      M: PDFString.fromDate(new Date()),
      AP: { N: doc.context.register(ap) },
    });
    const ref = doc.context.register(annot);
    let annots = p.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = doc.context.obj([]);
      p.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
    return save(doc);
  },

  // Plain text stamped into the page content with an embedded Unicode font
  // (used for "type on page" where full Turkish glyph coverage is needed).
  async addText({ bytes, page, x, y, text, size = 12, color = [0, 0, 0] }) {
    const doc = await load(bytes);
    checkIndices(doc, [page]);
    doc.registerFontkit(fontkit);
    fontBytes = fontBytes || fs.readFileSync(FONT_PATH);
    const font = await doc.embedFont(fontBytes, { subset: true });
    const p = doc.getPage(page);
    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, k) => {
      p.drawText(line, { x, y: y - size - k * size * 1.25, size, font, color: rgb(...color) });
    });
    return save(doc);
  },

  // pdf.js writes free-text annotations and form fields with the standard Helvetica font,
  // which cannot show Turkish letters such as ş, ğ, ı and İ. Other viewers (Acrobat, browsers)
  // then show missing characters. This rebuilds those appearances with an embedded Unicode
  // font. Returns the original bytes untouched when nothing needs fixing.
  async fixAppearances({ bytes }) {
    let doc;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
      return bytes; // e.g. encrypted documents: keep pdf.js output as is.
    }
    let font = null;
    const getFont = async () => {
      if (!font) {
        doc.registerFontkit(fontkit);
        fontBytes = fontBytes || fs.readFileSync(FONT_PATH);
        font = await doc.embedFont(fontBytes, { subset: true });
      }
      return font;
    };
    let changed = false;

    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookup(i);
        if (!annot || typeof annot.get !== 'function') continue;
        if (String(annot.get(PDFName.of('Subtype'))) !== '/FreeText') continue;
        const contents = annot.lookup(PDFName.of('Contents'));
        const text = contents && typeof contents.decodeText === 'function' ? contents.decodeText() : '';
        if (!text || (annot.get(PDFName.of('AP')) && isWinAnsi(text))) continue;
        await buildFreeTextAppearance(doc, annot, text, await getFont());
        changed = true;
      }
    }

    try {
      const form = doc.getForm();
      for (const field of form.getFields()) {
        const name = field.constructor.name;
        let value = '';
        if (name === 'PDFTextField') value = field.getText() || '';
        else if (name === 'PDFDropdown' || name === 'PDFOptionList') value = field.getSelected().join('');
        else continue;
        if (!value || isWinAnsi(value)) continue;
        field.updateAppearances(await getFont());
        changed = true;
      }
      if (changed) form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(false));
    } catch {
      // Malformed forms: leave them as pdf.js wrote them.
    }

    if (!changed) return bytes;
    return save(doc);
  },

  async flattenForm({ bytes }) {
    const doc = await load(bytes);
    const form = doc.getForm();
    if (form.getFields().length === 0) throw new OpError('Bu belgede form alanı yok.');
    try {
      doc.registerFontkit(fontkit);
      fontBytes = fontBytes || fs.readFileSync(FONT_PATH);
      const font = await doc.embedFont(fontBytes, { subset: true });
      form.updateFieldAppearances(font);
    } catch {
      // Fall back to existing appearances.
    }
    form.flatten();
    return save(doc);
  },

  async setMetadata({ bytes, title, author, subject, keywords }) {
    const doc = await load(bytes);
    if (title !== undefined) doc.setTitle(title, { showInWindowTitleBar: true });
    if (author !== undefined) doc.setAuthor(author);
    if (subject !== undefined) doc.setSubject(subject);
    if (keywords !== undefined) doc.setKeywords(String(keywords).split(/[,;]\s*/).filter(Boolean));
    doc.setModificationDate(new Date());
    doc.setProducer('Katip PDF');
    return save(doc);
  },

  async create({ width = 595.28, height = 841.89 } = {}) {
    const doc = await PDFDocument.create();
    doc.addPage([width, height]);
    doc.setProducer('Katip PDF');
    return save(doc);
  },

  // Images (PNG/JPEG) -> PDF, one image per page.
  async imagesToPdf({ images }) {
    const doc = await PDFDocument.create();
    for (const img of images) {
      const isPng = img[0] === 0x89 && img[1] === 0x50;
      const embedded = isPng ? await doc.embedPng(img) : await doc.embedJpg(img);
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    return save(doc);
  },
};

// Characters available in WinAnsiEncoding (Latin-1 plus the cp1252 extras).
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function isWinAnsi(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13) continue;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) continue;
    if (CP1252_EXTRA.includes(ch)) continue;
    return false;
  }
  return true;
}

function parseDA(da) {
  const s = String(da || '');
  const size = parseFloat((s.match(/([\d.]+)\s+Tf/) || [])[1]) || 12;
  let color = [0, 0, 0];
  const rgb = s.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  const gray = s.match(/([\d.]+)\s+g(\s|$)/);
  if (rgb) color = rgb.slice(1, 4).map(Number);
  else if (gray) color = [Number(gray[1]), Number(gray[1]), Number(gray[1])];
  return { size, color };
}

// Same layout rules pdf.js uses for its own free-text appearances.
async function buildFreeTextAppearance(doc, annot, text, font) {
  const da = annot.lookup(PDFName.of('DA'));
  const { size, color } = parseDA(da && (da.decodeText ? da.decodeText() : da.toString()));
  const rect = annot.lookup(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  const rotObj = annot.lookup(PDFName.of('Rotate'));
  const rotation = rotObj ? ((rotObj.asNumber() % 360) + 360) % 360 : 0;
  let w = rect[2] - rect[0];
  let h = rect[3] - rect[1];
  if (rotation % 180 !== 0) [w, h] = [h, w];

  const lines = text.split(/\r\n?|\n/);
  const maxWidth = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)), 1);
  const lineHeight = 1.35 * size;
  const scale = Math.min(maxWidth > w ? w / maxWidth : 1, lineHeight * lines.length > h ? h / (lineHeight * lines.length) : 1);
  const fs = size * scale;
  const lh = 1.35 * fs;
  const ascent = 1.0 * fs;

  const matrices = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] };
  const origins = {
    0: [rect[0], rect[3]], 90: [rect[1], -rect[0]], 180: [-rect[2], -rect[1]], 270: [-rect[3], rect[2]],
  };
  const clips = {
    0: [rect[0], rect[1]], 90: [rect[1], -rect[2]], 180: [-rect[2], -rect[3]], 270: [-rect[3], rect[0]],
  };
  const m = matrices[rotation] || matrices[0];
  const [ox, oy] = origins[rotation] || origins[0];
  const [cx, cy] = clips[rotation] || clips[0];
  const n = (v) => (Math.round(v * 1000) / 1000).toString();

  const ops = ['q', `${m.join(' ')} 0 0 cm`, `${n(cx)} ${n(cy)} ${n(w)} ${n(h)} re W n`, 'BT',
    `${color.map(n).join(' ')} rg`, `/KatipF ${n(fs)} Tf`, `${n(ox)} ${n(oy - ascent)} Td`];
  lines.forEach((line, i) => {
    if (i) ops.push(`0 ${n(-lh)} Td`);
    ops.push(`${font.encodeText(line).toString()} Tj`);
  });
  ops.push('ET', 'Q');

  const stream = doc.context.flateStream(ops.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: rect,
    Matrix: [1, 0, 0, 1, -rect[0], -rect[1]],
    Resources: { Font: { KatipF: font.ref } },
  });
  const ref = doc.context.register(stream);
  annot.set(PDFName.of('AP'), doc.context.obj({ N: ref }));
}

function copyInfo(from, to) {
  try {
    const t = from.getTitle();
    if (t) to.setTitle(t);
    const a = from.getAuthor();
    if (a) to.setAuthor(a);
  } catch {
    // Metadata is optional.
  }
  to.setProducer('Katip PDF');
}

async function run(op, args) {
  const fn = ops[op];
  if (!fn) throw new Error(`Bilinmeyen işlem: ${op}`);
  try {
    return await fn(args || {});
  } catch (err) {
    // Electron strips custom error classes; keep a readable message.
    throw new Error(err instanceof OpError ? err.message : `İşlem başarısız: ${err.message}`);
  }
}

module.exports = { run, ops };
