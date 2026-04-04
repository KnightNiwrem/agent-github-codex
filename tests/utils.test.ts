import { describe, expect, it } from "bun:test";
import { z } from "zod";
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
