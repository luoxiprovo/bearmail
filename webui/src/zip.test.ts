import { describe, expect, it } from "vitest";
import { buildZip, crc32, sanitizeZipName, uniqueZipNames } from "./zip";

describe("zip helpers", () => {
  it("sanitizes names and de-duplicates collisions", () => {
    expect(sanitizeZipName("../secret/notes.txt")).toBe("_secret_notes.txt");
    expect(uniqueZipNames(["a.txt", "a.txt", "plain"])).toEqual(["a.txt", "a (1).txt", "plain"]);
  });

  it("builds a store-method zip with local and central headers", () => {
    const zip = buildZip([
      { name: "one.txt", bytes: new TextEncoder().encode("hello") },
      { name: "two.txt", bytes: new TextEncoder().encode("world") },
    ]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    expect(new TextDecoder().decode(zip)).toContain("one.txt");
    expect(new TextDecoder().decode(zip)).toContain("hello");
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  });
});
