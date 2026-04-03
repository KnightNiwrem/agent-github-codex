#!/usr/bin/env bun

import { handleCliError, runCli } from "../src/cli";

await runCli().catch((error: unknown) => {
  handleCliError(error);
});
