import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { normalizeHyphenDelimiters, slugSegment } from "../src/utils";
import { formatZodError } from "../src/zod-utils";

describe("formatZodError", () => {
  it("normalizes prettified errors into a single line when requested", () => {
    const schema = z.object({
      number: z.number(),
    });
    const parsed = schema.safeParse({});

    expect(parsed.success).toBeFalse();
    if (parsed.success) {
      return;
    }

    const formatted = formatZodError(parsed.error, { singleLine: true });
    expect(formatted).not.toContain("\n");
    expect(formatted).toContain("number");
  });
});

describe("slug helpers", () => {
  it("shares dash normalization with slug segments", () => {
    expect(normalizeHyphenDelimiters("--feature---name--")).toBe(
      "feature-name",
    );
    expect(slugSegment("Fëature   name!!!")).toBe("feature-name");
  });
});
