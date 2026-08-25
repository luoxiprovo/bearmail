import DOMPurify from "dompurify";

export interface InlineImage {
  cid: string;
  name: string;
  type: string;
  dataUrl: string;
  bytes: Uint8Array;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function plainTextToHtml(text: string): string {
  return text.split(/\n{2,}/).map((block) => {
    const html = escapeHtml(block).replace(/\n/g, "<br>");
    return `<p>${html || "<br>"}</p>`;
  }).join("");
}

export function htmlToPlainText(html: string): string {
  const document_ = new DOMParser().parseFromString(html || "", "text/html");
  document_.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  document_.querySelectorAll("p, div, li, h1, h2, h3, blockquote, tr").forEach((node) => {
    node.append("\n");
  });
  return (document_.body.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function sanitizeComposeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "strike",
      "a", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3",
      "font", "img", "hr",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "width", "height", "style", "color", "face", "size", "align"],
    ALLOW_DATA_ATTR: false,
  });
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function dataUrlToBytes(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { type: match[1], bytes };
}

export function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const document_ = new DOMParser().parseFromString(html || "", "text/html");
  const images: InlineImage[] = [];
  document_.querySelectorAll("img").forEach((image, index) => {
    const src = image.getAttribute("src") ?? "";
    const parsed = dataUrlToBytes(src);
    if (!parsed) return;
    const cid = `img${index + 1}@bearmail`;
    const subtype = parsed.type.split("/")[1] || "jpeg";
    images.push({
      cid,
      name: `image-${index + 1}.${subtype}`,
      type: parsed.type,
      dataUrl: src,
      bytes: parsed.bytes,
    });
    image.setAttribute("src", `cid:${cid}`);
  });
  return { html: document_.body.innerHTML, images };
}

export async function fileToCompressedDataUrl(file: File, maxWidth = 240, quality = 0.62): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / Math.max(bitmap.width, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be prepared.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).match(/.{1,76}/g)?.join("\r\n") ?? "";
}
