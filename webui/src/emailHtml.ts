import DOMPurify from "dompurify";

export function isExternalRsvpHref(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, "https://invalid.example");
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
  const action = url.searchParams.get("action")?.toLowerCase();
  if (host === "calendar.google.com" || (host === "google.com" && pathAndQuery.includes("/calendar/event"))) {
    return action === "respond" || url.searchParams.has("rst");
  }
  if (host.endsWith("outlook.office.com") || host.endsWith("outlook.live.com") || host.endsWith("office365.com")) {
    return /rsvp|respond/.test(pathAndQuery);
  }
  return false;
}

export function stripExternalRsvpLinks(document_: Document): void {
  for (const link of [...document_.querySelectorAll("a")]) {
    if (!isExternalRsvpHref(link.getAttribute("href") ?? link.href)) continue;
    const row = link.closest("tr");
    link.remove();
    if (row && !row.querySelector("a") && !row.textContent?.trim()) row.remove();
  }
}

export function sanitizeEmailHtml(
  rawHtml: string,
  options: { allowImages: boolean; stripExternalRsvp?: boolean },
): { html: string; hasRemoteImages: boolean } {
  const hasRemoteImages = /<img[^>]+src=["']https?:/i.test(rawHtml);
  const clean = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ["script", "style", "form", "input", "button", "video", "audio"],
    FORBID_ATTR: ["srcset", "onerror", "onclick"],
  });
  const document_ = new DOMParser().parseFromString(clean, "text/html");
  document_.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  if (options.stripExternalRsvp) stripExternalRsvpLinks(document_);
  if (!options.allowImages) document_.querySelectorAll("img[src^='http']").forEach((image) => image.remove());
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.allowImages ? "https: http: data: cid:" : "data: cid:"}; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'">`;
  const style = `<style>body{margin:0;color:#273640;font:15px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}a{color:#0d7068}img{max-width:100%;height:auto}blockquote{border-left:3px solid #d9dfe1;margin-left:0;padding-left:16px;color:#64737c}</style>`;
  return { html: `<!doctype html><html><head>${csp}${style}</head><body>${document_.body.innerHTML}</body></html>`, hasRemoteImages };
}
