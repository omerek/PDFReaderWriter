'use strict';

// Format conversions (Windows only): PDF -> Word (.docx), Word (.docx) -> PDF, and 3D model export.
//
// PDF -> Word: the renderer extracts text with pdf.js (positions, sizes, font names) and sends plain
// data here; this module groups it into lines and paragraphs and writes a .docx (Office Open XML).
// Pages without text (scanned) are put into the document as a picture of the page.

const zlib = require('zlib');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream } = require('pdf-lib');

// ---------------------------------------------------------------- zip (deflate) writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    const packed = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, packed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---------------------------------------------------------------- text layout
const xmlEsc = (s) => String(s)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fontFamily(name = '') {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  if (/courier|mono|consol/i.test(n)) return 'Courier New';
  if (/times|serif|roman|georgia|garamond|cambria|minion/i.test(n) && !/sans/i.test(n)) return 'Times New Roman';
  if (/calibri/i.test(n)) return 'Calibri';
  if (/verdana/i.test(n)) return 'Verdana';
  if (/tahoma/i.test(n)) return 'Tahoma';
  return 'Arial';
}
const isBold = (it) => it.bold || /bold|black|heavy|semibold|demi/i.test(it.font || '');
const isItalic = (it) => it.italic || /italic|oblique/i.test(it.font || '');

/** Groups positioned text items (PDF coordinates, y up) into lines of runs. */
function buildLines(items) {
  const list = items.filter((it) => it.str && it.str.length && it.size > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of list) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.size, it.size) * 0.45);
    if (line) { line.items.push(it); line.size = Math.max(line.size, it.size); }
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = l.items[0].x;
    const last = l.items[l.items.length - 1];
    l.x1 = last.x + (last.w || 0);
    l.runs = [];
    let prev = null;
    for (const it of l.items) {
      let text = it.str;
      if (prev) {
        const gap = it.x - (prev.x + (prev.w || 0));
        const sep = /\s$/.test(prev.str) || /^\s/.test(text);
        if (gap > it.size * 2.5) text = `\t${text.replace(/^\s+/, '')}`;
        else if (!sep && gap > it.size * 0.18) text = ` ${text}`;
      }
      const style = { b: isBold(it), i: isItalic(it), sz: Math.round(it.size * 2) / 2, font: fontFamily(it.font) };
      const r = l.runs[l.runs.length - 1];
      if (r && r.b === style.b && r.i === style.i && r.sz === style.sz && r.font === style.font) r.text += text;
      else l.runs.push({ ...style, text });
      prev = it;
    }
  }
  return lines.sort((a, b) => b.y - a.y);
}

/** Groups lines into paragraphs using spacing, size and line-length heuristics. */
function buildParagraphs(lines, pageWidth) {
  if (!lines.length) return [];
  const left = Math.min(...lines.map((l) => l.x0));
  const right = Math.max(...lines.map((l) => l.x1));
  const textWidth = Math.max(1, right - left);
  const paras = [];
  let cur = null;
  let prev = null;
  for (const l of lines) {
    const gap = prev ? prev.y - l.y : 0;
    const newPara = !cur
      || gap > Math.max(prev.size, l.size) * 1.75
      || Math.abs(prev.size - l.size) > 1.5
      || prev.x1 < left + textWidth * 0.72 // previous line ended early
      || l.x0 > prev.x0 + l.size * 1.5 // indented line starts a paragraph
      || l.runs.some((r) => r.text.includes('\t')) || prev.runs.some((r) => r.text.includes('\t'));
    if (newPara) {
      cur = { lines: [l], spaceBefore: prev ? Math.max(0, gap - prev.size * 1.2) : 0 };
      paras.push(cur);
    } else {
      cur.lines.push(l);
    }
    prev = l;
  }
  return paras.map((p) => {
    const first = p.lines[0];
    const runs = [];
    p.lines.forEach((l, i) => {
      l.runs.forEach((r, j) => {
        let text = r.text;
        if (i > 0 && j === 0) {
          const last = runs[runs.length - 1];
          if (last && /[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(last.text) && /^[a-zçğıöşü]/.test(text)) last.text = last.text.slice(0, -1);
          else if (last && !/\s$/.test(last.text)) text = ` ${text.replace(/^\s+/, '')}`;
        }
        const prevRun = runs[runs.length - 1];
        if (prevRun && prevRun.b === r.b && prevRun.i === r.i && prevRun.sz === r.sz && prevRun.font === r.font) prevRun.text += text;
        else runs.push({ ...r, text });
      });
    });
    const single = p.lines.length === 1;
    const mid = (first.x0 + first.x1) / 2;
    const center = single && first.x1 - first.x0 < textWidth * 0.8
      && Math.abs(mid - (left + right) / 2) < textWidth * 0.06 && first.x0 > left + textWidth * 0.1;
    const indent = Math.max(0, Math.min(...p.lines.slice(1).map((l) => l.x0), first.x0) - left);
    const firstLine = p.lines.length > 1 ? Math.max(0, first.x0 - left - indent) : 0;
    return {
      runs,
      align: center ? 'center' : 'left',
      indent: center ? 0 : indent,
      firstLine: center ? 0 : firstLine,
      spaceBefore: Math.min(p.spaceBefore, 48),
      margin: { left, right: pageWidth - right },
    };
  });
}

function runXml(r) {
  const props = [
    `<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}" w:cs="${r.font}"/>`,
    r.b ? '<w:b/>' : '',
    r.i ? '<w:i/>' : '',
    `<w:sz w:val="${Math.max(2, Math.round(r.sz * 2))}"/>`,
  ].join('');
  return r.text.split('\t').map((part, i) => (i ? `<w:r><w:rPr>${props}</w:rPr><w:tab/></w:r>` : '')
    + (part ? `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEsc(part)}</w:t></w:r>` : '')).join('');
}

const tw = (pt) => Math.round(pt * 20);

function paragraphXml(p, pageBreak) {
  const ppr = [
    '<w:pPr>',
    `<w:spacing w:before="${tw(p.spaceBefore)}" w:after="0" w:line="264" w:lineRule="auto"/>`,
    p.indent || p.firstLine ? `<w:ind w:left="${tw(p.indent)}" w:firstLine="${tw(p.firstLine)}"/>` : '',
    p.align === 'center' ? '<w:jc w:val="center"/>' : '',
    '</w:pPr>',
  ].join('');
  return `<w:p>${ppr}${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}${p.runs.map(runXml).join('')}</w:p>`;
}

function imageParagraphXml(id, rid, cx, cy, pageBreak) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:drawing>`
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Sayfa ${id}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="sayfa${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/**
 * pages: [{ width, height, items: [{ str, x, y, w, size, font, bold, italic }], image?: Uint8Array(PNG) }]
 * Returns the .docx file bytes.
 */
function pdfToDocx({ pages, title = '' }) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('Dönüştürülecek sayfa yok.');
  const first = pages[0];
  const pw = first.width || 595;
  const ph = first.height || 842;
  const body = [];
  const media = [];
  // Margins from the text of the first text page, clamped to sensible values.
  let marginL = 56;
  let marginR = 56;
  pages.forEach((pg, i) => {
    const pageBreak = i > 0;
    const lines = buildLines(pg.items || []);
    if (!lines.length && pg.image) {
      const rid = `rIdImg${media.length + 1}`;
      media.push({ name: `word/media/sayfa${media.length + 1}.png`, data: Buffer.from(pg.image), rid });
      const maxW = pw - 2 * 28;
      const maxH = ph - 2 * 28;
      const s = Math.min(maxW / (pg.width || pw), maxH / (pg.height || ph));
      body.push(imageParagraphXml(media.length, rid, Math.round((pg.width || pw) * s * 12700), Math.round((pg.height || ph) * s * 12700), pageBreak));
      return;
    }
    const paras = buildParagraphs(lines, pg.width || pw);
    if (i === 0 && paras.length) {
      marginL = Math.min(Math.max(paras[0].margin.left, 28), 110);
      marginR = Math.min(Math.max(paras[0].margin.right, 28), 110);
    }
    if (!paras.length) body.push(`<w:p>${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}</w:p>`);
    paras.forEach((p, j) => body.push(paragraphXml(p, pageBreak && j === 0)));
  });
  // Images use page-sized margins of 28pt; text pages use the detected margins.
  const hasText = pages.some((p) => (p.items || []).length);
  if (!hasText) { marginL = 28; marginR = 28; }
  const landscape = pw > ph;
  const sect = `<w:sectPr><w:pgSz w:w="${tw(pw)}" w:h="${tw(ph)}"${landscape ? ' w:orient="landscape"' : ''}/>`
    + `<w:pgMar w:top="${hasText ? 1134 : 560}" w:right="${tw(marginR)}" w:bottom="${hasText ? 1134 : 560}" w:left="${tw(marginL)}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + `<w:body>${body.join('')}${sect}</w:body></w:document>`;
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>'
    + '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name.slice(5)}"/>`).join('')
    + '</Relationships>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${xmlEsc(title)}</dc:title><dc:creator>Katip PDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

  const out = zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...media.map((m) => ({ name: m.name, data: m.data })),
  ]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

// ---------------------------------------------------------------- Word -> HTML (for printToPDF)
async function docxToHtml(bytes) {
  const mammoth = require('mammoth');
  let res;
  try {
    res = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  } catch (err) {
    throw new Error('Word dosyası okunamadı. Sadece .docx biçimi desteklenir (eski .doc değil).');
  }
  return '<!doctype html><html lang="tr"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">'
    + '<style>@page{size:A4;margin:2cm 2cm 2cm 2.2cm}body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;color:#000}'
    + 'h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}p{margin:0 0 6pt}img{max-width:100%;height:auto}'
    + 'table{border-collapse:collapse;width:100%;margin:6pt 0}td,th{border:1px solid #777;padding:3pt 5pt;vertical-align:top}'
    + 'ul,ol{margin:0 0 6pt}</style></head><body>'
    + `${res.value}</body></html>`;
}

// ---------------------------------------------------------------- 3D annotations
function decodeStream(stream) {
  if (stream instanceof PDFRawStream) {
    const raw = Buffer.from(stream.getContents());
    const filter = stream.dict.get(PDFName.of('Filter'));
    const names = filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
    let data = raw;
    for (const f of names) {
      if (f === '/FlateDecode') data = zlib.inflateSync(data);
      else throw new Error(`Desteklenmeyen sıkıştırma: ${f}`);
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return stream.getContents ? stream.getContents() : new Uint8Array();
}

/** Lists the 3D models (U3D / PRC) embedded in 3D annotations, with their bytes. */
async function find3D({ bytes, withData = false }) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) return;
    annots.asArray().forEach((ref) => {
      const a = doc.context.lookup(ref);
      if (!(a instanceof PDFDict) || String(a.get(PDFName.of('Subtype'))) !== '/3D') return;
      let dd = a.lookup(PDFName.of('3DD'));
      // A 3D reference dictionary points to the stream of another annotation.
      if (dd instanceof PDFDict && !(dd instanceof PDFStream) && dd.has(PDFName.of('3DD'))) dd = dd.lookup(PDFName.of('3DD'));
      if (!(dd instanceof PDFStream)) return;
      const sub = String(dd.dict.get(PDFName.of('Subtype')) || '').replace('/', '') || 'U3D';
      const rect = a.lookup(PDFName.of('Rect'));
      const item = {
        page: pageIndex,
        format: sub.toUpperCase(),
        rect: rect instanceof PDFArray ? rect.asArray().map((n) => n.asNumber?.() ?? 0) : null,
      };
      if (withData) item.data = decodeStream(dd);
      out.push(item);
    });
  });
  return out;
}

module.exports = { pdfToDocx, docxToHtml, find3D, buildLines, buildParagraphs, zip, crc32 };
