/** Uploads to the server's asset store (kept in the data dir, so links survive restarts and work for collaborators). */
export async function postAsset(dataUrl: string, kind: "plan" | "cutout" | "model"): Promise<{ id: string; url: string }> {
  const response = await fetch("/api/assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl, kind }) });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error ?? `Upload failed (${response.status}).`);
  return { id: payload.id!, url: payload.url };
}

/** Downscales an image (long side ≤ maxSide), uploads it, and returns its URL and aspect (height / width). */
export async function uploadImage(file: File, kind: "plan" | "cutout", maxSide = 2400) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPG or WebP image.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} could not be read as an image.`); });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff"; // plans with transparency read better on white
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const uploaded = await postAsset(canvas.toDataURL("image/jpeg", 0.9), kind);
  return { ...uploaded, aspect: canvas.height / canvas.width, name: file.name.replace(/\.[^.]+$/, "") };
}

export async function uploadModelFile(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return postAsset("data:model/gltf-binary;base64," + btoa(binary), "model");
}

/** Uploads an image that's already a data URL (e.g. the plan from "Upload a plan") and measures its aspect. */
export async function uploadDataUrl(dataUrl: string, kind: "plan" | "cutout") {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const uploaded = await postAsset(dataUrl, kind);
  return { ...uploaded, aspect: image.naturalHeight / Math.max(1, image.naturalWidth) };
}
