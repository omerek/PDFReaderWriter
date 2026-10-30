'use strict';

// Editing the original text of a PDF page.
//
// A page's text lives in its content stream as text-showing operators (Tj, TJ, ', ").
// To replace a line of text we
//   1. parse the content stream and replay the text state to find where every glyph lands,
//   2. turn the glyphs that fall inside the edited line into plain spacing (so the
//      text after them in the same operator keeps its position), and
//   3. draw the new text in the same place with an embedded font.
// Glyphs are really removed from the file, not just covered up.

const {
  PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream,
} = require('pdf-lib');

// ------------------------------------------------------------------ lexer

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/**
 * Parses a content stream (as a latin1 string) into operations:
 * { op, args, start, end } where start/end delimit the operation's source text.
 */
function parseContent(src) {
  const n = src.length;
  let i = 0;
  const ops = [];
  const stack = []; // operand stack; containers are arrays with a marker
  let opStart = -1;

  const code = (k) => src.charCodeAt(k);
  const skipWs = () => {
    while (i < n) {
      const c = code(i);
      if (WS.has(c)) { i++; continue; }
      if (c === 0x25) { // % comment
        while (i < n && code(i) !== 0x0a && code(i) !== 0x0d) i++;
        continue;
      }
      break;
    }
  };

  function readLiteralString() {
    // i points after '('
    let depth = 1;
    const out = [];
    while (i < n) {
      const ch = src[i++];
      if (ch === '\\') {
        const e = src[i++];
        if (e === undefined) break;
        if (e === 'n') out.push(10);
        else if (e === 'r') out.push(13);
        else if (e === 't') out.push(9);
        else if (e === 'b') out.push(8);
        else if (e === 'f') out.push(12);
        else if (e === '\r') { if (src[i] === '\n') i++; } else if (e === '\n') { /* line continuation */ } else if (e >= '0' && e <= '7') {
          let oct = e;
          for (let k = 0; k < 2 && src[i] >= '0' && src[i] <= '7'; k++) oct += src[i++];
          out.push(parseInt(oct, 8) & 0xff);
        } else out.push(e.charCodeAt(0));
      } else if (ch === '(') {
        depth++;
        out.push(0x28);
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
        out.push(0x29);
      } else {
        out.push(ch.charCodeAt(0) & 0xff);
      }
    }
    return { type: 'string', bytes: out };
  }

  function readHexString() {
    // i points after '<'
    let hex = '';
    while (i < n && src[i] !== '>') {
      if (/[0-9a-fA-F]/.test(src[i])) hex += src[i];
      i++;
    }
    i++; // '>'
    if (hex.length % 2) hex += '0';
    const out = [];
    for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
    return { type: 'string', bytes: out };
  }

  function readToken() {
    const start = i;
    while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
    return src.slice(start, i);
  }

  function push(value) {
    const top = stack[stack.length - 1];
    if (top && top.__container) top.items.push(value);
    else stack.push(value);
  }

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const tokStart = i;
    const c = src[i];
    if (opStart < 0) opStart = tokStart;

    if (c === '(') { i++; push(readLiteralString()); continue; }
    if (c === '<') {
      if (src[i + 1] === '<') { i += 2; stack.push({ __container: 'dict', items: [] }); continue; }
      i++; push(readHexString()); continue;
    }
    if (c === '>' && src[i + 1] === '>') {
      i += 2;
      const d = stack.pop();
      const obj = {};
      for (let k = 0; k + 1 < d.items.length; k += 2) obj[d.items[k].name] = d.items[k + 1];
      push({ type: 'dict', value: obj });
      continue;
    }
    if (c === '[') { i++; stack.push({ __container: 'array', items: [] }); continue; }
    if (c === ']') {
      i++;
      const a = stack.pop();
      push({ type: 'array', items: a && a.items ? a.items : [] });
      continue;
    }
    if (c === '/') {
      i++;
      push({ type: 'name', name: readToken() });
      continue;
    }
    if (c === '{' || c === '}' || c === ')' || c === '>') { i++; continue; } // stray delimiters

    const tok = readToken();
    if (!tok) { i++; continue; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { push({ type: 'number', value: parseFloat(tok) }); continue; }
    if (tok === 'true' || tok === 'false') { push({ type: 'bool', value: tok === 'true' }); continue; }
    if (tok === 'null') { push({ type: 'null' }); continue; }

    // Operator.
    if (tok === 'BI') {
      // Inline image: skip everything up to the EI keyword.
      const idx = findInlineImageEnd(src, i);
      i = idx;
      ops.push({ op: 'BI', args: [], start: opStart, end: i });
    } else {
      // Unclosed containers are flattened back into the operand list.
      const args = [];
      for (const v of stack) args.push(v.__container ? { type: v.__container, items: v.items } : v);
      ops.push({ op: tok, args, start: opStart, end: i });
    }
    stack.length = 0;
    opStart = -1;
  }
  return ops;
}

function findInlineImageEnd(src, from) {
  const id = src.indexOf('ID', from);
  if (id < 0) return src.length;
  let k = id + 3;
  while (k < src.length) {
    const e = src.indexOf('EI', k);
    if (e < 0) return src.length;
    const before = src.charCodeAt(e - 1);
    const after = e + 2 >= src.length ? 0x20 : src.charCodeAt(e + 2);
    if (WS.has(before) && (WS.has(after) || DELIM.has(after))) return e + 2;
    k = e + 2;
  }
  return src.length;
}

// ------------------------------------------------------------------ matrices

const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
const IDENTITY = [1, 0, 0, 1, 0, 0];

// ------------------------------------------------------------------ fonts

function num(obj, def = 0) {
  return obj instanceof PDFNumber ? obj.asNumber() : def;
}

function fontInfo(fontDict) {
  const info = { bytes: 1, scale: 0.001, widths: new Map(), dw: 500 };
  if (!(fontDict instanceof PDFDict)) return info;
  const subtype = String(fontDict.get(PDFName.of('Subtype')) || '');
  if (subtype === '/Type0') {
    info.bytes = 2;
    info.dw = 1000;
    const desc = fontDict.lookup(PDFName.of('DescendantFonts'));
    const cid = desc instanceof PDFArray ? desc.lookup(0) : null;
    if (cid instanceof PDFDict) {
      info.dw = num(cid.lookup(PDFName.of('DW')), 1000);
      const w = cid.lookup(PDFName.of('W'));
      if (w instanceof PDFArray) {
        const arr = w.asArray().map((x) => cid.context.lookup(x));
        for (let k = 0; k < arr.length;) {
          const first = num(arr[k]);
          const next = arr[k + 1];
          if (next instanceof PDFArray) {
            next.asArray().forEach((x, j) => info.widths.set(first + j, num(cid.context.lookup(x))));
            k += 2;
          } else {
            const last = num(next);
            const width = num(arr[k + 2]);
            for (let c = first; c <= last && c - first < 65536; c++) info.widths.set(c, width);
            k += 3;
          }
        }
      }
    }
    return info;
  }
  if (subtype === '/Type3') {
    const fm = fontDict.lookup(PDFName.of('FontMatrix'));
    if (fm instanceof PDFArray) info.scale = num(fm.lookup(0), 0.001);
  }
  const first = num(fontDict.lookup(PDFName.of('FirstChar')), 0);
  const widths = fontDict.lookup(PDFName.of('Widths'));
  if (widths instanceof PDFArray) {
    widths.asArray().forEach((x, j) => info.widths.set(first + j, num(fontDict.context.lookup(x))));
  }
  const fd = fontDict.lookup(PDFName.of('FontDescriptor'));
  if (fd instanceof PDFDict) {
    const mw = num(fd.lookup(PDFName.of('MissingWidth')), 0);
    if (mw) info.dw = mw;
    else if (!info.widths.size) info.dw = num(fd.lookup(PDFName.of('AvgWidth')), 500) || 500;
  }
  return info;
}

function codesOf(bytes, font) {
  const out = [];
  if (font.bytes === 2) {
    for (let k = 0; k + 1 < bytes.length; k += 2) out.push({ code: (bytes[k] << 8) | bytes[k + 1], raw: [bytes[k], bytes[k + 1]] });
  } else {
    for (const b of bytes) out.push({ code: b, raw: [b] });
  }
  return out;
}

const hex = (bytes) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

// ------------------------------------------------------------------ glyph removal

/**
 * Removes the glyphs whose centre lies inside `region` from a content stream.
 * region: { origin:[x,y], u:[ux,uy], v:[vx,vy], width, height } in user space, where u is the
 * text direction and v the "up" direction of the edited line.
 * Returns { content, removed }.
 */
function removeGlyphs(content, resources, region) {
  const ops = parseContent(content);
  const fontsDict = resources && resources.lookup(PDFName.of('Font'));
  const fontCache = new Map();
  const getFont = (name) => {
    if (!fontCache.has(name)) {
      const dict = fontsDict instanceof PDFDict ? fontsDict.lookup(PDFName.of(name)) : null;
      fontCache.set(name, fontInfo(dict));
    }
    return fontCache.get(name);
  };

  const inside = (p) => {
    const dx = p[0] - region.origin[0];
    const dy = p[1] - region.origin[1];
    const s = dx * region.u[0] + dy * region.u[1];
    const t = dx * region.v[0] + dy * region.v[1];
    const h = region.height;
    return s >= -0.25 * h && s <= region.width + 0.1 * h && t >= -0.45 * h && t <= 1.0 * h;
  };

  let gs = { ctm: IDENTITY, Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, Tfs: 0, Trise: 0 };
  const gstack = [];
  let Tm = IDENTITY;
  let Tlm = IDENTITY;
  const edits = [];
  let removed = 0;

  // Shows a string; returns TJ array items when something was removed, else null.
  function show(bytes) {
    const font = gs.font || { bytes: 1, scale: 0.001, widths: new Map(), dw: 500 };
    const items = [];
    let kept = [];
    let gap = 0;
    let changed = false;
    const canRewrite = gs.Tfs * gs.Th !== 0;
    for (const g of codesOf(bytes, font)) {
      const w = font.widths.has(g.code) ? font.widths.get(g.code) : font.dw;
      const isSpace = font.bytes === 1 && g.code === 32;
      const adv = (w * font.scale * gs.Tfs + gs.Tc + (isSpace ? gs.Tw : 0)) * gs.Th;
      const centre = apply(mul(Tm, gs.ctm), adv / 2, gs.Trise + 0.3 * gs.Tfs);
      if (canRewrite && inside(centre)) {
        if (kept.length) { items.push(hex(kept)); kept = []; }
        gap += adv;
        changed = true;
        removed++;
      } else {
        if (gap) { items.push(fmt((-gap * 1000) / (gs.Tfs * gs.Th))); gap = 0; }
        kept.push(...g.raw);
      }
      Tm = mul(translate(adv, 0), Tm);
    }
    if (kept.length) items.push(hex(kept));
    if (gap) items.push(fmt((-gap * 1000) / (gs.Tfs * gs.Th)));
    return changed ? items : null;
  }

  function nextLine() {
    Tlm = mul(translate(0, -gs.TL), Tlm);
    Tm = Tlm;
  }

  for (const o of ops) {
    const a = o.args;
    const nums = a.map((x) => (x && x.type === 'number' ? x.value : 0));
    switch (o.op) {
      case 'q': gstack.push({ ...gs }); break;
      case 'Q': if (gstack.length) gs = gstack.pop(); break;
      case 'cm': if (a.length >= 6) gs.ctm = mul(nums.slice(-6), gs.ctm); break;
      case 'BT': Tm = IDENTITY; Tlm = IDENTITY; break;
      case 'Tc': gs.Tc = nums[0]; break;
      case 'Tw': gs.Tw = nums[0]; break;
      case 'Tz': gs.Th = nums[0] / 100; break;
      case 'TL': gs.TL = nums[0]; break;
      case 'Ts': gs.Trise = nums[0]; break;
      case 'Tf':
        if (a[0] && a[0].type === 'name') gs.font = getFont(a[0].name);
        gs.Tfs = nums[1];
        break;
      case 'Td': Tlm = mul(translate(nums[0], nums[1]), Tlm); Tm = Tlm; break;
      case 'TD': gs.TL = -nums[1]; Tlm = mul(translate(nums[0], nums[1]), Tlm); Tm = Tlm; break;
      case 'Tm': if (a.length >= 6) { Tlm = nums.slice(-6); Tm = Tlm; } break;
      case 'T*': nextLine(); break;
      case 'Tj': {
        if (!a[0] || a[0].type !== 'string') break;
        const items = show(a[0].bytes);
        if (items) edits.push({ start: o.start, end: o.end, text: `[${items.join(' ')}] TJ` });
        break;
      }
      case "'": {
        nextLine();
        if (!a[0] || a[0].type !== 'string') break;
        const items = show(a[0].bytes);
        if (items) edits.push({ start: o.start, end: o.end, text: `T* [${items.join(' ')}] TJ` });
        break;
      }
      case '"': {
        gs.Tw = nums[0];
        gs.Tc = nums[1];
        nextLine();
        if (!a[2] || a[2].type !== 'string') break;
        const items = show(a[2].bytes);
        if (items) edits.push({ start: o.start, end: o.end, text: `${fmt(nums[0])} Tw ${fmt(nums[1])} Tc T* [${items.join(' ')}] TJ` });
        break;
      }
      case 'TJ': {
        const arr = a[0];
        if (!arr || arr.type !== 'array') break;
        const out = [];
        let changed = false;
        for (const el of arr.items) {
          if (el.type === 'number') {
            Tm = mul(translate((-el.value / 1000) * gs.Tfs * gs.Th, 0), Tm);
            out.push(fmt(el.value));
          } else if (el.type === 'string') {
            const items = show(el.bytes);
            if (items) { changed = true; out.push(...items); } else out.push(hex(el.bytes));
          }
        }
        if (changed) edits.push({ start: o.start, end: o.end, text: `[${out.join(' ')}] TJ` });
        break;
      }
      default:
        break;
    }
  }

  if (!edits.length) return { content, removed: 0 };
  let result = '';
  let pos = 0;
  for (const e of edits) {
    result += content.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  result += content.slice(pos);
  return { content: result, removed };
}

// ------------------------------------------------------------------ page helpers

function streamBytes(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream && typeof stream.getUnencodedContents === 'function') return stream.getUnencodedContents();
  if (stream instanceof PDFStream) return stream.getContents();
  return new Uint8Array();
}

function pageContent(page) {
  const { context } = page.doc;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((r) => context.lookup(r))
    : contents ? [contents] : [];
  return streams.map((s) => Buffer.from(streamBytes(s)).toString('latin1')).join('\n');
}

function setPageContent(page, latin1) {
  const { context } = page.doc;
  const stream = context.flateStream(Buffer.from(latin1, 'latin1'));
  const ref = context.register(stream);
  page.node.set(PDFName.of('Contents'), context.obj([ref]));
}

module.exports = { parseContent, removeGlyphs, pageContent, setPageContent, mul, apply };
