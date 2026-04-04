import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_EDIT_MODE_FLAG, CODEX_TEXT_SANDBOX } from "./config";
import {
  coerceBranchName,
  fallbackBranchName,
  fallbackCommitMessage,
  fallbackPullRequestDraft,
  parseDraftResponse,
} from "./fallbacks";
import { createHarnessTempDirectory } from "./harness";
import type { PullRequestDraft, ReviewComment, ShellRunner } from "./types";

async function withTempOutputFile<T>(
  stateDir: string,
  callback: (outputFile: string) => Promise<T>,
): Promise<{ value: T; output: string }> {
  const directory = await createHarnessTempDirectory(stateDir);
  const outputFile = join(directory, "last-message.txt");

  try {
    const value = await callback(outputFile);
    const output = await readFile(outputFile, "utf8").catch(() => "");

    return { value, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class CodexClient {
  constructor(private readonly shell: ShellRunner) {}

  private async promptCodex<T>(
    cwd: string,
    stateDir: string,
    prompt: string,
    fallback: T,
    parse: (output: string) => T | null,
  ): Promise<T> {
    try {
      const { output } = await withTempOutputFile(
        stateDir,
        async (outputFile) => {
          await this.shell.run({
            args: [
              "codex",
              "exec",
              "--ephemeral",
              "--color",
              "never",
              "--sandbox",
              CODEX_TEXT_SANDBOX,
              "-o",
              outputFile,
              prompt,
            ],
            cwd,
            allowFailure: true,
          });
        },
      );

      return parse(output) ?? fallback;
    } catch {
      return fallback;
    }
  }

  async generateBranchName(
    cwd: string,
    prompt: string,
    stateDir: string,
  ): Promise<string> {
    const fallback = fallbackBranchName(prompt);
    const candidate = await this.promptCodex(
      cwd,
      stateDir,
      [
        "Return only a git branch name.",
        "Use the format feature/<kebab-slug>.",
        "Do not include quotes, code fences, or explanations.",
        `Prompt: ${prompt}`,
      ].join("\n"),
      fallback,
      (output) => {
        const branchName = coerceBranchName(output);

        return branchName.length > 0 ? branchName : null;
      },
    );

    if (candidate === fallback) {
      return fallback;
    }

    const isValid = await this.shell.run({
      args: ["git", "check-ref-format", "--branch", candidate],
      cwd,
      allowFailure: true,
    });

    return isValid.exitCode === 0 ? candidate : fallback;
  }

  async implementPrompt(cwd: string, prompt: string): Promise<void> {
    await this.shell.run({
      args: [
        "codex",
        "exec",
        "--ephemeral",
        "--color",
        "never",
        CODEX_EDIT_MODE_FLAG,
        "-C",
        cwd,
        [
          "Implement the requested change in this repository.",
          "Work deterministically, update tests/docs when needed, and stop when the task is complete.",
          `User request: ${prompt}`,
        ].join("\n\n"),
      ],
      cwd,
    });
  }

  async generateCommitMessage(
    cwd: string,
    prompt: string,
    stagedDiff: string,
    mode: "implementation" | "review",
    stateDir: string,
  ): Promise<string> {
    const fallback = fallbackCommitMessage(prompt, mode);

    return await this.promptCodex(
      cwd,
      stateDir,
      [
        "Return only a single conventional commit message line.",
        "Do not include quotes or explanations.",
        `Mode: ${mode}`,
        `Original prompt: ${prompt}`,
        `Staged diff summary: ${stagedDiff || "No diff summary available."}`,
      ].join("\n"),
      fallback,
      (output) => output.trim().split(/\r?\n/, 1)[0]?.trim() || null,
    );
  }

  async generatePullRequestDraft(
    cwd: string,
    prompt: string,
    branch: string,
    baseBranch: string,
    branchDiff: string,
    stateDir: string,
  ): Promise<PullRequestDraft> {
    const fallback = fallbackPullRequestDraft(prompt, branch, baseBranch);

    return await this.promptCodex(
      cwd,
      stateDir,
      [
        "Draft a GitHub pull request title and body.",
        "Respond in exactly this format:",
        "TITLE: <one line title>",
        "BODY:",
        "<markdown body>",
        "",
        `Original prompt: ${prompt}`,
        `Head branch: ${branch}`,
        `Base branch: ${baseBranch}`,
        `Diff summary: ${branchDiff || "No diff summary available."}`,
      ].join("\n"),
      fallback,
      parseDraftResponse,
    );
  }

  async addressReviewComments(
    cwd: string,
    prompt: string,
    reviewComments: ReviewComment[],
  ): Promise<void> {
    const renderedComments = reviewComments
      .map((comment) =>
        [
          `- ID: ${comment.id}`,
          `  Path: ${comment.path ?? "n/a"}`,
          `  Line: ${comment.line ?? "n/a"}`,
          `  Body: ${comment.body}`,
          `  URL: ${comment.url ?? "n/a"}`,
        ].join("\n"),
      )
      .join("\n");

    await this.shell.run({
      args: [
        "codex",
        "exec",
        "--ephemeral",
        "--color",
        "never",
        CODEX_EDIT_MODE_FLAG,
        "-C",
        cwd,
        [
          "Review the new pull request review comments and address only valid issues.",
          "If a comment is incorrect or already satisfied, leave the files unchanged.",
          "Do not rewrite unrelated code.",
          `Original user prompt: ${prompt}`,
          "New review comments:",
          renderedComments,
        ].join("\n\n"),
      ],
      cwd,
    });
  }
}
