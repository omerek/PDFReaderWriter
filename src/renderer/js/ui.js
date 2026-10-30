// Small UI helpers: element factory, toasts, busy overlay and modal dialogs.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function toast(message, { error = false, timeout = 3200 } = {}) {
  const t = el('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, message);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), error ? Math.max(timeout, 6000) : timeout);
}

let busyCount = 0;
export async function busy(text, fn) {
  busyCount++;
  $('#busyText').textContent = text || 'İşleniyor…';
  // Show the overlay only for operations that take a noticeable time.
  const timer = setTimeout(() => { if (busyCount) $('#busy').hidden = false; }, 180);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    busyCount--;
    if (!busyCount) $('#busy').hidden = true;
  }
}

/**
 * Show the shared modal dialog.
 * buttons: [{ label, value, primary, validate }] ; returns the clicked button's value
 * (or null when dismissed). `body` may be a Node or a function receiving the body element.
 */
export function showDialog({ title, body, buttons = [{ label: 'Tamam', value: true, primary: true }], onOpen, width }) {
  const dlg = $('#dialog');
  const bodyEl = $('#dialogBody');
  const btns = $('#dialogButtons');
  $('#dialogTitle').textContent = title || '';
  bodyEl.replaceChildren();
  btns.replaceChildren();
  dlg.style.width = width ? `${width}px` : '';
  if (typeof body === 'function') body(bodyEl);
  else if (body) bodyEl.append(body);

  return new Promise((resolve) => {
    let result = null;
    for (const b of buttons) {
      const btn = el('button', { class: `btn${b.primary ? ' primary' : ''}`, type: 'button' }, b.label);
      btn.addEventListener('click', async () => {
        if (b.validate) {
          const ok = await b.validate(bodyEl);
          if (!ok) return;
        }
        result = typeof b.value === 'function' ? await b.value(bodyEl) : b.value;
        dlg.close();
      });
      btns.append(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        btns.querySelector('.btn.primary')?.click();
      }
    };
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('close', () => {
      dlg.removeEventListener('keydown', onKey);
      resolve(result);
    }, { once: true });
    dlg.showModal();
    onOpen?.(bodyEl);
    const first = bodyEl.querySelector('input, textarea, select');
    if (first) { first.focus(); first.select?.(); }
  });
}

export async function prompt({ title, label, value = '', type = 'text', multiline = false, okLabel = 'Tamam' }) {
  const input = multiline
    ? el('textarea', {}, value)
    : el('input', { type, value });
  const res = await showDialog({
    title,
    body: el('label', { class: 'form-row' }, el('span', {}, label || ''), input),
    buttons: [
      { label: 'İptal', value: null },
      { label: okLabel, value: () => input.value, primary: true },
    ],
  });
  return res;
}

export function alertDialog(title, message) {
  return showDialog({ title, body: el('p', { style: { whiteSpace: 'pre-wrap', userSelect: 'text' } }, message) });
}

export function confirmDialog(title, message, okLabel = 'Tamam', cancelLabel = 'İptal') {
  return showDialog({
    title,
    body: el('p', { style: { whiteSpace: 'pre-wrap' } }, message),
    buttons: [{ label: cancelLabel, value: false }, { label: okLabel, value: true, primary: true }],
  });
}

// Parses "1-3, 5, 8-" style page ranges into zero-based indices.
export function parsePageRanges(text, pageCount) {
  const out = [];
  const parts = String(text).split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a;
    let b;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : pageCount;
    } else if (/^\d+$/.test(part)) {
      a = b = parseInt(part, 10);
    } else {
      return null;
    }
    if (a < 1 || b > pageCount || a > b) return null;
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  return out;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

export function basename(p) {
  return String(p || '').split(/[\\/]/).pop();
}
