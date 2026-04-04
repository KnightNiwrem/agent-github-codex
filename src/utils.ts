import { createHash } from "node:crypto";

export function slugSegment(value: string): string {
  const ascii = Array.from(value.normalize("NFKD"))
    .filter((character) => character.charCodeAt(0) <= 0x7f)
    .join("");

  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength < 3) {
    return value.slice(0, Math.max(0, maxLength));
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function stableHash(value: string, length = 8): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}
