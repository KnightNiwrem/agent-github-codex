#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { ConsoleLogger } from "./logger";
import { BunShellRunner } from "./shell";
import { runPromptWorkflow } from "./workflow";

function readCliVersion(): string {
  const version = packageJson.version;

  if (typeof version !== "string") {
    throw new Error("package.json must define a non-empty string version");
  }

  const trimmedVersion = version.trim();

  if (trimmedVersion.length === 0) {
    throw new Error("package.json must define a non-empty string version");
  }

  return trimmedVersion;
}

export const CLI_VERSION = readCliVersion();

export function createProgram(): Command {
  const program = new Command();

  program
    .name("agc")
    .description(
      "Deterministic Bun CLI harness for Git, GitHub CLI, and Codex CLI.",
    )
    .version(CLI_VERSION)
    .option(
      "--max-unproductive-polls <count>",
      "Number of consecutive review polls with no new actionable comments before exiting; 0 means poll indefinitely",
      (value: string) => {
        const parsed = Number.parseInt(value, 10);

        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error(
            "--max-unproductive-polls must be a non-negative integer",
          );
        }

        return parsed;
      },
      1,
    )
    .argument("<prompt>", "Prompt describing the requested repository change")
    .action(
      async (prompt: string, options: { maxUnproductivePolls: number }) => {
        const logger = new ConsoleLogger();
        const shell = new BunShellRunner();
        const result = await runPromptWorkflow(prompt, {
          shell,
          logger,
          options: {
            maxUnproductivePolls: options.maxUnproductivePolls,
          },
        });

        logger.info("workflow.complete", {
          branch: result.branch,
          baseBranch: result.baseBranch,
          committed: result.committed,
          pullRequestNumber: result.pr?.number,
          pullRequestUrl: result.pr?.url,
          reviewLoopReason: result.reviewLoopReason,
        });
      },
    );

  return program;
}

if (import.meta.main) {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exitCode = 1;
  }
}
