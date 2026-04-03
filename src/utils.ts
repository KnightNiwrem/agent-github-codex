import { createHash } from "node:crypto";

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
