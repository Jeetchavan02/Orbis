/** Sharing helpers: WhatsApp click-to-chat links and the native share sheet. */

export const shareMessage = (link: string) => `Check out my 3D room design on Orbis! Open and explore it here: ${link}`;

/**
 * WhatsApp's universal share link: opens the app on phones and WhatsApp Web/Desktop on computers, with the text
 * prefilled and the contact or group picked by the user. It carries text only; files can't be attached this way.
 */
export const whatsAppUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function openWhatsApp(text: string) {
  window.open(whatsAppUrl(text), "_blank", "noopener,noreferrer");
}

/** True when this browser can hand files to the OS share sheet (most phones, Safari, Chrome on Windows/ChromeOS). */
export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
