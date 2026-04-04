import { z } from "zod";
import { normalizeWhitespace } from "./utils";

export function formatZodError(
  error: z.ZodError,
  options?: { singleLine?: boolean },
): string {
  const formatted = z.prettifyError(error);

  if (options?.singleLine) {
    return normalizeWhitespace(formatted);
  }

  return formatted;
}
