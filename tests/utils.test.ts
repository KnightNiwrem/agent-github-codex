import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { formatZodError } from "../src/zod-utils";

describe("formatZodError", () => {
  it("preserves human-readable formatting by default", () => {
    const schema = z.object({
      pullRequestReviewers: z.array(z.string()).min(1),
    });
    const parsed = schema.safeParse({});

    expect(parsed.success).toBeFalse();
    if (parsed.success) {
      return;
    }

    expect(formatZodError(parsed.error)).toContain("\n");
  });

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
