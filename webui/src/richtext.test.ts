import { describe, expect, it } from "vitest";
import { extractInlineImages, htmlToPlainText, looksLikeHtml, plainTextToHtml, sanitizeComposeHtml } from "./richtext";

describe("rich text helpers", () => {
  it("converts paragraphs and line breaks both ways", () => {
    expect(plainTextToHtml("Hello\nthere\n\nAda")).toContain("<p>Hello<br>there</p>");
    expect(htmlToPlainText("<p>Hello<br>there</p><p>Ada</p>")).toMatch(/Hello\s+there\s+Ada/);
  });

  it("strips scripts from compose HTML and rewrites data images to cid", () => {
    const dirty = `<p>Hi<script>alert(1)</script></p><img src="data:image/png;base64,QQ==" alt="logo">`;
    const clean = sanitizeComposeHtml(dirty);
    expect(clean).not.toContain("script");
    const extracted = extractInlineImages(clean);
    expect(extracted.html).toContain("cid:img1@bearmail");
    expect(extracted.images[0]?.type).toBe("image/png");
    expect(extracted.images[0]?.bytes.length).toBeGreaterThan(0);
  });

  it("detects HTML bodies", () => {
    expect(looksLikeHtml("<p>Hi</p>")).toBe(true);
    expect(looksLikeHtml("Just text")).toBe(false);
  });
});
