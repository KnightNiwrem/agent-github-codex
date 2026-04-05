import { z } from "zod";

const maxUnproductivePollsSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, {
    error: "--max-unproductive-polls must be a non-negative integer",
  })
  .transform((value) => Number.parseInt(value, 10));

export function parseMaxUnproductivePolls(value: string): number {
  const parsed = maxUnproductivePollsSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error("--max-unproductive-polls must be a non-negative integer");
  }

  return parsed.data;
}
