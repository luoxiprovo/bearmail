import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "./mail";

describe("MIME draft builder", () => {
  it("removes injected header lines and preserves Unicode", async () => {
    const blob = await buildMimeMessage({ to: "reader@example.test", subject: "Hello\r\nBcc: intruder@example.test", body: "Hej 👋" }, {
      id: "one", name: "Ada", email: "ada@example.test",
    });
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain("Subject: Hello Bcc: intruder@example.test");
    expect(text).not.toContain("\r\nBcc: intruder@example.test");
    expect(text).toContain("Hej 👋");
  });
});
