export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    table[index] = crc >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function sanitizeZipName(name: string): string {
  const trimmed = name.replace(/[/\\]+/g, "_").replace(/^\.+/, "").trim() || "attachment";
  return trimmed.slice(0, 180);
}

export function uniqueZipNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const base = sanitizeZipName(raw);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf(".");
    if (dot > 0) return `${base.slice(0, dot)} (${count})${base.slice(dot)}`;
    return `${base} (${count})`;
  });
}

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const names = uniqueZipNames(entries.map((entry) => entry.name));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const nameBytes = new TextEncoder().encode(names[index]);
    const data = entries[index].bytes;
    const crc = crc32(data);
    const localHeader = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]);
    const local = concat(localHeader, nameBytes, data);
    const central = concat(Uint8Array.from([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ]), nameBytes);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);
  return concat(...localParts, ...centralParts, end);
}

export function zipBlob(entries: ZipEntry[]): Blob {
  const bytes = buildZip(entries);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: "application/zip" });
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
