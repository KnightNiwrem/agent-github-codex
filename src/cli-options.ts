import { z } from "zod";
import { formatZodError } from "./zod-utils";

const maxUnproductivePollsErrorMessage =
  "--max-unproductive-polls must be a non-negative integer";
const maxUnproductivePollsSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, {
    message: maxUnproductivePollsErrorMessage,
  })
  .transform((value, context) => {
    const parsed = BigInt(value);

    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      context.addIssue({
        code: "custom",
        message: maxUnproductivePollsErrorMessage,
      });

      return z.NEVER;
    }

    return Number(parsed);
  });

export function parseMaxUnproductivePolls(value: string): number {
  const parsed = maxUnproductivePollsSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error, { singleLine: true }));
  }

  return parsed.data;
}
