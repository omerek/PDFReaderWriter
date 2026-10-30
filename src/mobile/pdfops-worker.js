// Android: runs the same pdf-lib operations as the desktop main process, in a web worker.
import pdfops from '../main/pdfops.js';

function transferables(value, list = new Set()) {
  if (value instanceof Uint8Array) list.add(value.buffer);
  else if (Array.isArray(value)) value.forEach((v) => transferables(v, list));
  return [...list];
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    const result = await pdfops.run(op, args);
    self.postMessage({ id, result }, transferables(result));
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
