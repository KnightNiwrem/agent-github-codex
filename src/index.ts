#!/usr/bin/env bun

import { Command } from "commander";
import { ConsoleLogger } from "./logger";
import { BunShellRunner } from "./shell";
import { runPromptWorkflow } from "./workflow";

const program = new Command();

program
  .name("deer-agent")
  .description(
    "Deterministic Bun CLI harness for Git, GitHub CLI, and Codex CLI.",
  )
  .argument("<prompt>", "Prompt describing the requested repository change")
  .action(async (prompt: string) => {
    const logger = new ConsoleLogger();
    const shell = new BunShellRunner();
    const result = await runPromptWorkflow(prompt, { shell, logger });

    logger.info("workflow.complete", {
      branch: result.branch,
      baseBranch: result.baseBranch,
      committed: result.committed,
      pullRequestNumber: result.pr?.number,
      pullRequestUrl: result.pr?.url,
      reviewLoopReason: result.reviewLoopReason,
    });
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
}
