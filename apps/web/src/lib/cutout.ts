/**
 * Background removal for product-style photos, entirely in the browser.
 *
 * The background colour is estimated from the image border, then a flood fill from every border pixel
 * clears connected pixels within `tolerance` of it. Pixels near the threshold get partial alpha so edges
 * stay soft, and the result is cropped to the object. Works best on plain or evenly lit backgrounds.
 */
export type Cutout = { dataUrl: string; width: number; height: number; coverage: number };

const MAX_SIDE = 1024;

/** Decodes an image file. The image keeps an object URL as its src; call `URL.revokeObjectURL(image.src)` when done. */
export async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function removeBackground(image: HTMLImageElement, tolerance: number): Cutout {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, w, h);
  const pixels = g.getImageData(0, 0, w, h);
  const data = pixels.data;

  // Background estimate: per-channel median of the border pixels.
  const border: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    border[0]!.push(data[i]!);
    border[1]!.push(data[i + 1]!);
    border[2]!.push(data[i + 2]!);
  };
  for (let x = 0; x < w; x += 1) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += 1) { sample(0, y); sample(w - 1, y); }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
  const bg = border.map(median) as [number, number, number];

  const distance = (i: number) => Math.hypot(data[i]! - bg[0], data[i + 1]! - bg[1], data[i + 2]! - bg[2]);
  const hard = tolerance;
  const soft = tolerance * 1.6;

  // Flood fill from the border through background-coloured pixels.
  const state = new Uint8Array(w * h); // 0 unvisited, 1 background, 2 edge (partial)
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = (p: number) => {
    if (state[p] || data[p * 4 + 3]! < 8 || distance(p * 4) <= hard) {
      if (!state[p]) { state[p] = 1; queue[tail++] = p; }
    }
  };
  for (let x = 0; x < w; x += 1) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w;
    const y = (p / w) | 0;
    const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const n of neighbours) {
      if (n < 0 || state[n]) continue;
      const d = distance(n * 4);
      if (d <= hard) { state[n] = 1; queue[tail++] = n; }
      else if (d <= soft) state[n] = 2;
    }
  }

  // Apply alpha, tracking the object's bounding box.
  let minX = w, minY = h, maxX = -1, maxY = -1, kept = 0;
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (state[p] === 1) data[i + 3] = 0;
    else if (state[p] === 2) data[i + 3] = Math.round(data[i + 3]! * Math.min(1, (distance(i) - hard) / (soft - hard)));
    if (data[i + 3]! > 24) {
      kept += 1;
      const x = p % w;
      const y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  g.putImageData(pixels, 0, 0);
  if (maxX < 0) return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h, coverage: 0 };

  const pad = 2;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - cx;
  const ch = Math.min(h, maxY + pad + 1) - cy;
  const cropped = document.createElement("canvas");
  cropped.width = cw;
  cropped.height = ch;
  cropped.getContext("2d")!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return { dataUrl: cropped.toDataURL("image/png"), width: cw, height: ch, coverage: kept / (w * h) };
}
