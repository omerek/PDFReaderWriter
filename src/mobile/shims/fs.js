// Minimal "fs" for pdfops.js inside the Android web worker: font files are fetched
// synchronously from the app's own web server (synchronous XHR is allowed in workers).
export function readFileSync(file) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', file, false);
  xhr.responseType = 'arraybuffer';
  xhr.send();
  if (xhr.status !== 200 && xhr.status !== 0) throw new Error(`Dosya okunamadı: ${file} (${xhr.status})`);
  return new Uint8Array(xhr.response);
}

export default { readFileSync };
