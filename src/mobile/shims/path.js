// Minimal POSIX "path" for pdfops.js inside the Android web worker.
export function join(...parts) {
  const out = [];
  for (const seg of parts.join('/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}

export function basename(p) {
  return String(p).split('/').pop();
}

export const sep = '/';

export default { join, basename, sep };
