import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexClient } from "./codex";
import { AppError } from "./errors";
import type { HarnessWorkspaceState } from "./harness";
import { ConsoleLogger } from "./logger";
import type { CommandResult, CommandSpec, Logger, ShellRunner } from "./types";
import { runPromptWorkflow } from "./workflow";

const testFileDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testFileDirectory, "..");
const temporaryDirectories: string[] = [];
const gitStatusExcludingHarness = [
  "git",
  "status",
  "--porcelain",
  "--",
  ".",
  ":(exclude).agc",
];
const gitAddExcludingHarness = [
  "git",
  "add",
  "--all",
  "--",
  ".",
  ":(exclude).agc",
];

interface Step {
  match(args: string[]): boolean;
  run(spec: CommandSpec): Promise<CommandResult>;
}

class SequenceShellRunner implements ShellRunner {
  readonly calls: string[][] = [];

  constructor(private readonly steps: Step[]) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec.args);

    const step = this.steps.shift();

    if (!step) {
      throw new Error(`Unexpected command: ${spec.args.join(" ")}`);
    }

    if (!step.match(spec.args)) {
      throw new Error(`Unexpected command order: ${spec.args.join(" ")}`);
    }

    return await step.run(spec);
  }

  assertComplete(): void {
    expect(this.steps.length).toBe(0);
  }
}

function result(stdout = "", stderr = "", exitCode = 0): CommandResult {
  return {
    stdout,
    stderr,
    exitCode,
  };
}

function exact(args: string[], commandResult: CommandResult = result()): Step {
  return {
    match: (actual) => JSON.stringify(actual) === JSON.stringify(args),
    run: async () => commandResult,
  };
}

function dynamic(
  matcher: (args: string[]) => boolean,
  responder: (spec: CommandSpec) => Promise<CommandResult> | CommandResult,
): Step {
  return {
    match: matcher,
    run: async (spec) => await responder(spec),
  };
}

function codexOutputContains(snippet: string, output: string): Step {
  return dynamic(
    (args) =>
      args[0] === "codex" &&
      args[1] === "exec" &&
      args.includes("-o") &&
      (args.at(-1) ?? "").includes(snippet),
    async (spec) => {
      expect(spec.allowFailure).toBe(true);
      expect(spec.args).toContain("--ephemeral");
      expect(spec.args).toContain("--color");
      expect(spec.args).toContain("never");
      expect(spec.args).toContain("--sandbox");
      const outputIndex = spec.args.indexOf("-o");
      const outputFile = spec.args[outputIndex + 1];

      if (!outputFile) {
        throw new Error("Missing codex output file");
      }

      await writeFile(outputFile, output);
      return result();
    },
  );
}

function codexEditContains(
  snippet: string,
  onRun?: (spec: CommandSpec) => void,
): Step {
  return dynamic(
    (args) =>
      args[0] === "codex" &&
      args[1] === "exec" &&
      !args.includes("-o") &&
      (args.at(-1) ?? "").includes(snippet),
    async (spec) => {
      onRun?.(spec);
      return result();
    },
  );
}

class TestLogger implements Logger {
  readonly entries: Array<{ event: string; fields?: Record<string, unknown> }> =
    [];

  info(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ event, fields });
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ event, fields });
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ event, fields });
  }
}

function stubHarness(
  reviewers: string[] = ["@copilot"],
  trustedReviewCommenters: string[] = reviewers,
): {
  ensure: (repoRoot: string) => Promise<HarnessWorkspaceState>;
} {
  return {
    ensure: async (repoRoot: string) => {
      const stateDir = await mkdtemp(join(tmpdir(), "agc-workflow-tests-"));
      temporaryDirectories.push(stateDir);

      return {
        rootDir: join(repoRoot, ".agc"),
        stateDir,
        configFile: join(repoRoot, ".agc", "config.json"),
        config: {
          pullRequestReviewers: reviewers,
          trustedReviewCommenters,
        },
      };
    },
  };
}

beforeEach(() => {
  process.chdir(repositoryRoot);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workflow guards", () => {
  it("fails on dirty workspace", async () => {
    const shell = new SequenceShellRunner([
      exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
      exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
      exact(gitStatusExcludingHarness, result(" M README.md\n")),
    ]);

    await expect(
      runPromptWorkflow("update docs", {
        shell,
        logger: new TestLogger(),
        harness: stubHarness(),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(
      new AppError("Workspace must be clean before running this CLI."),
    );

    shell.assertComplete();
  });

  it("fails when current branch is not main or master", async () => {
    const shell = new SequenceShellRunner([
      exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
      exact(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        result("feature/already\n"),
      ),
    ]);

    await expect(
      runPromptWorkflow("update docs", {
        shell,
        logger: new TestLogger(),
        harness: stubHarness(),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(
      new AppError(
        "Current branch must be main or master before running this CLI.",
      ),
    );

    shell.assertComplete();
  });

  it("ignores harness-owned .agc changes during workspace guard and no-op detection", async () => {
    const shell = new SequenceShellRunner([
      exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
      exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
      exact(gitStatusExcludingHarness, result("")),
      codexOutputContains("Return only a git branch name.", "feature/no-op\n"),
      exact(["git", "check-ref-format", "--branch", "feature/no-op"], result()),
      exact(["git", "checkout", "-b", "feature/no-op", "main"], result()),
      codexEditContains("Implement the requested change in this repository."),
      exact(gitStatusExcludingHarness, result("")),
      exact(["git", "checkout", "main"], result()),
    ]);

    const workflow = await runPromptWorkflow("No-op request", {
      shell,
      logger: new TestLogger(),
      harness: stubHarness(),
      sleep: async () => undefined,
    });

    expect(workflow.committed).toBe(false);
    expect(workflow.reviewLoopReason).toBe("no_initial_changes");
    shell.assertComplete();
  });
});

it("feature branch naming falls back deterministically", async () => {
  const shell = new SequenceShellRunner([
    codexOutputContains("Return only a git branch name.", ""),
  ]);
  const client = new CodexClient(shell);
  const stateDir = await mkdtemp(join(tmpdir(), "agc-workflow-tests-"));
  temporaryDirectories.push(stateDir);
  const branch = await client.generateBranchName(
    "/repo",
    "Add logging to CLI",
    stateDir,
  );

  expect(branch).toMatch(/^feature\/add-logging-to-cli-[a-f0-9]{6}$/);
  shell.assertComplete();
});

it("commit message generation falls back when codex output is blank", async () => {
  const shell = new SequenceShellRunner([
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "\n",
    ),
  ]);
  const client = new CodexClient(shell);
  const stateDir = await mkdtemp(join(tmpdir(), "agc-workflow-tests-"));
  temporaryDirectories.push(stateDir);

  const message = await client.generateCommitMessage(
    "/repo",
    "Update docs",
    " README.md | 2 +-\n",
    "implementation",
    stateDir,
  );

  expect(message).toBe("feat: implement Update docs");
  shell.assertComplete();
});

it("pull request draft generation falls back when codex output is invalid", async () => {
  const shell = new SequenceShellRunner([
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "not valid",
    ),
  ]);
  const client = new CodexClient(shell);
  const stateDir = await mkdtemp(join(tmpdir(), "agc-workflow-tests-"));
  temporaryDirectories.push(stateDir);

  const draft = await client.generatePullRequestDraft(
    "/repo",
    "Update docs",
    "feature/docs",
    "main",
    " README.md | 2 +-\n",
    stateDir,
  );

  expect(draft).toEqual({
    title: "feat: Update docs",
    body: [
      "## Summary",
      "- Requested change: Update docs",
      "- Head branch: `feature/docs`",
      "- Base branch: `main`",
      "",
      "## Notes",
      "- Generated by the deterministic Bun Codex harness.",
    ].join("\n"),
  });
  shell.assertComplete();
});

it("skips commit and PR creation when codex makes no changes", async () => {
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains("Return only a git branch name.", "feature/no-op\n"),
    exact(["git", "check-ref-format", "--branch", "feature/no-op"], result()),
    exact(["git", "checkout", "-b", "feature/no-op", "main"], result()),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result("")),
    exact(["git", "checkout", "main"], result()),
  ]);
  const logger = new TestLogger();

  const workflow = await runPromptWorkflow("No-op request", {
    shell,
    logger,
    harness: stubHarness(),
    sleep: async () => undefined,
  });

  expect(workflow.committed).toBe(false);
  expect(workflow.reviewLoopReason).toBe("no_initial_changes");
  expect(
    logger.entries.some(
      (entry) =>
        entry.event === "branch.restored" &&
        entry.fields?.reason === "no_initial_changes",
    ),
  ).toBe(true);
  expect(shell.calls.some((args) => args[0] === "gh")).toBe(false);
  expect(
    shell.calls.some((args) => args[0] === "git" && args[1] === "commit"),
  ).toBe(false);
  shell.assertComplete();
});

it("stages repository changes while excluding harness-owned .agc paths", async () => {
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains("Return only a git branch name.", "feature/docs\n"),
    exact(["git", "check-ref-format", "--branch", "feature/docs"], result()),
    exact(["git", "checkout", "-b", "feature/docs", "main"], result()),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result(" M README.md\n")),
    exact(gitAddExcludingHarness, result()),
    exact(["git", "diff", "--cached", "--stat"], result(" README.md | 2 +-\n")),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "docs: update readme\n",
    ),
    exact(["git", "commit", "-m", "docs: update readme"], result()),
    exact(["git", "push", "-u", "origin", "feature/docs"], result()),
    exact(
      ["git", "diff", "main...HEAD", "--stat"],
      result(" README.md | 2 +-\n"),
    ),
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "TITLE: docs: update readme\nBODY:\nSummary\n",
    ),
    exact(
      [
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/docs",
        "--title",
        "docs: update readme",
        "--body",
        "Summary",
      ],
      result(),
    ),
    exact(
      [
        "gh",
        "pr",
        "view",
        "feature/docs",
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      result(
        '{"number":12,"url":"https://example.com/pr/12","headRefName":"feature/docs","baseRefName":"main","title":"docs: update readme","body":"Summary"}\n',
      ),
    ),
    exact(["gh", "pr", "edit", "12", "--add-reviewer", "@copilot"], result()),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/12/comments",
      ],
      result("[[]]\n"),
    ),
  ]);

  const workflow = await runPromptWorkflow("Update docs", {
    shell,
    logger: new TestLogger(),
    harness: stubHarness(),
    sleep: async () => undefined,
  });

  expect(workflow.committed).toBe(true);
  expect(workflow.pr?.number).toBe(12);
  shell.assertComplete();
});

it("review loop terminates when review fixes produce no file changes", async () => {
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains(
      "Return only a git branch name.",
      "feature/review-pass\n",
    ),
    exact(
      ["git", "check-ref-format", "--branch", "feature/review-pass"],
      result(),
    ),
    exact(["git", "checkout", "-b", "feature/review-pass", "main"], result()),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result(" M src/index.ts\n")),
    exact(gitAddExcludingHarness, result()),
    exact(
      ["git", "diff", "--cached", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "feat: implement change\n",
    ),
    exact(["git", "commit", "-m", "feat: implement change"], result()),
    exact(["git", "push", "-u", "origin", "feature/review-pass"], result()),
    exact(
      ["git", "diff", "main...HEAD", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "TITLE: feat: implement change\nBODY:\nBody",
    ),
    exact(
      [
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/review-pass",
        "--title",
        "feat: implement change",
        "--body",
        "Body",
      ],
      result("https://example.test/pr/1\n"),
    ),
    exact(
      [
        "gh",
        "pr",
        "view",
        "feature/review-pass",
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      result(
        JSON.stringify({
          number: 1,
          url: "https://example.test/pr/1",
          title: "feat: implement change",
          body: "Body",
          headRefName: "feature/review-pass",
          baseRefName: "main",
        }),
      ),
    ),
    exact(["gh", "pr", "edit", "1", "--add-reviewer", "@copilot"], result()),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/1/comments",
      ],
      result(
        JSON.stringify([
          [
            {
              id: 101,
              body: "Please tighten this test",
              path: "src/workflow.ts",
              line: 42,
              user: {
                login: "copilot",
              },
              html_url: "https://example.test/comment/101",
            },
          ],
        ]),
      ),
    ),
    codexEditContains(
      "Review the new pull request review comments and address only valid issues.",
    ),
    exact(gitStatusExcludingHarness, result("")),
  ]);

  const workflow = await runPromptWorkflow("Implement something", {
    shell,
    logger: new TestLogger(),
    harness: stubHarness(),
    sleep: async () => undefined,
    reviewPollIntervalMs: 1,
  });

  expect(workflow.reviewLoopReason).toBe("codex_no_changes");
  expect(
    shell.calls.filter(
      (args) => args[0] === "gh" && args[1] === "pr" && args[2] === "edit",
    ).length,
  ).toBe(1);
  shell.assertComplete();
});

it("review loop respects max unproductive polls before exiting", async () => {
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains(
      "Return only a git branch name.",
      "feature/review-wait\n",
    ),
    exact(
      ["git", "check-ref-format", "--branch", "feature/review-wait"],
      result(),
    ),
    exact(["git", "checkout", "-b", "feature/review-wait", "main"], result()),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result(" M src/index.ts\n")),
    exact(gitAddExcludingHarness, result()),
    exact(
      ["git", "diff", "--cached", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "feat: initial change\n",
    ),
    exact(["git", "commit", "-m", "feat: initial change"], result()),
    exact(["git", "push", "-u", "origin", "feature/review-wait"], result()),
    exact(
      ["git", "diff", "main...HEAD", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "TITLE: feat: initial change\nBODY:\nBody",
    ),
    exact(
      [
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/review-wait",
        "--title",
        "feat: initial change",
        "--body",
        "Body",
      ],
      result("https://example.test/pr/4\n"),
    ),
    exact(
      [
        "gh",
        "pr",
        "view",
        "feature/review-wait",
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      result(
        JSON.stringify({
          number: 4,
          url: "https://example.test/pr/4",
          title: "feat: initial change",
          body: "Body",
          headRefName: "feature/review-wait",
          baseRefName: "main",
        }),
      ),
    ),
    exact(
      ["gh", "pr", "edit", "4", "--add-reviewer", "@review-bot,@copilot"],
      result(),
    ),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/4/comments",
      ],
      result(JSON.stringify([[]])),
    ),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/4/comments",
      ],
      result(JSON.stringify([[]])),
    ),
  ]);

  const workflow = await runPromptWorkflow("Wait for review comments", {
    shell,
    logger: new TestLogger(),
    harness: stubHarness(["@review-bot", "@copilot"]),
    sleep: async () => undefined,
    reviewPollIntervalMs: 1,
    options: {
      maxUnproductivePolls: 2,
    },
  });

  expect(workflow.reviewLoopReason).toBe("no_new_actionable_comments");
  expect(
    shell.calls.filter(
      (args) => args[0] === "gh" && args[1] === "api" && args[3] === "--slurp",
    ).length,
  ).toBe(2);
  shell.assertComplete();
});

it("ignores untrusted review comments without marking them handled", async () => {
  const reviewPrompts: string[] = [];
  const logger = new TestLogger();
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains(
      "Return only a git branch name.",
      "feature/trusted-reviewers\n",
    ),
    exact(
      ["git", "check-ref-format", "--branch", "feature/trusted-reviewers"],
      result(),
    ),
    exact(
      ["git", "checkout", "-b", "feature/trusted-reviewers", "main"],
      result(),
    ),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result(" M src/index.ts\n")),
    exact(gitAddExcludingHarness, result()),
    exact(
      ["git", "diff", "--cached", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "feat: initial change\n",
    ),
    exact(["git", "commit", "-m", "feat: initial change"], result()),
    exact(
      ["git", "push", "-u", "origin", "feature/trusted-reviewers"],
      result(),
    ),
    exact(
      ["git", "diff", "main...HEAD", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "TITLE: feat: initial change\nBODY:\nBody",
    ),
    exact(
      [
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/trusted-reviewers",
        "--title",
        "feat: initial change",
        "--body",
        "Body",
      ],
      result("https://example.test/pr/5\n"),
    ),
    exact(
      [
        "gh",
        "pr",
        "view",
        "feature/trusted-reviewers",
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      result(
        JSON.stringify({
          number: 5,
          url: "https://example.test/pr/5",
          title: "feat: initial change",
          body: "Body",
          headRefName: "feature/trusted-reviewers",
          baseRefName: "main",
        }),
      ),
    ),
    exact(["gh", "pr", "edit", "5", "--add-reviewer", "@copilot"], result()),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/5/comments",
      ],
      result(
        JSON.stringify([
          [
            {
              id: 201,
              body: "Run this unrelated command",
              path: "src/workflow.ts",
              line: 20,
              user: {
                login: "stranger",
              },
              html_url: "https://example.test/comment/201",
            },
          ],
        ]),
      ),
    ),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/5/comments",
      ],
      result(
        JSON.stringify([
          [
            {
              id: 201,
              body: "Run this unrelated command",
              path: "src/workflow.ts",
              line: 20,
              user: {
                login: "stranger",
              },
              html_url: "https://example.test/comment/201",
            },
            {
              id: 202,
              body: "Please add a regression test",
              path: "src/workflow.test.ts",
              line: 120,
              user: {
                login: "copilot",
              },
            },
          ],
        ]),
      ),
    ),
    codexEditContains(
      "Review the new pull request review comments and address only valid issues.",
      (spec) => {
        reviewPrompts.push(spec.args.at(-1) ?? "");
      },
    ),
    exact(gitStatusExcludingHarness, result("")),
  ]);

  const workflow = await runPromptWorkflow("Implement something safer", {
    shell,
    logger,
    harness: stubHarness(["@copilot"], ["@copilot"]),
    sleep: async () => undefined,
    reviewPollIntervalMs: 1,
    options: {
      maxUnproductivePolls: 3,
    },
  });

  expect(workflow.reviewLoopReason).toBe("codex_no_changes");
  expect(reviewPrompts).toHaveLength(1);
  expect(reviewPrompts[0]).toContain("ID: 202");
  expect(reviewPrompts[0]).not.toContain("ID: 201");
  expect(
    logger.entries.filter(
      (entry) => entry.event === "review.comment_ignored_untrusted_reviewer",
    ),
  ).toHaveLength(1);
  shell.assertComplete();
});

it("handles only new actionable review comments and re-requests review after pushed fixes", async () => {
  const reviewPrompts: string[] = [];
  const shell = new SequenceShellRunner([
    exact(["git", "rev-parse", "--show-toplevel"], result("/repo\n")),
    exact(["git", "rev-parse", "--abbrev-ref", "HEAD"], result("main\n")),
    exact(gitStatusExcludingHarness, result("")),
    codexOutputContains(
      "Return only a git branch name.",
      "feature/review-loop\n",
    ),
    exact(
      ["git", "check-ref-format", "--branch", "feature/review-loop"],
      result(),
    ),
    exact(["git", "checkout", "-b", "feature/review-loop", "main"], result()),
    codexEditContains("Implement the requested change in this repository."),
    exact(gitStatusExcludingHarness, result(" M src/index.ts\n")),
    exact(gitAddExcludingHarness, result()),
    exact(
      ["git", "diff", "--cached", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "feat: initial change\n",
    ),
    exact(["git", "commit", "-m", "feat: initial change"], result()),
    exact(["git", "push", "-u", "origin", "feature/review-loop"], result()),
    exact(
      ["git", "diff", "main...HEAD", "--stat"],
      result(" src/index.ts | 2 +-\n"),
    ),
    codexOutputContains(
      "Draft a GitHub pull request title and body.",
      "TITLE: feat: initial change\nBODY:\nBody",
    ),
    exact(
      [
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "feature/review-loop",
        "--title",
        "feat: initial change",
        "--body",
        "Body",
      ],
      result("https://example.test/pr/2\n"),
    ),
    exact(
      [
        "gh",
        "pr",
        "view",
        "feature/review-loop",
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      result(
        JSON.stringify({
          number: 2,
          url: "https://example.test/pr/2",
          title: "feat: initial change",
          body: "Body",
          headRefName: "feature/review-loop",
          baseRefName: "main",
        }),
      ),
    ),
    exact(["gh", "pr", "edit", "2", "--add-reviewer", "@copilot"], result()),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/2/comments",
      ],
      result(
        JSON.stringify([
          [
            {
              id: 101,
              body: "Please rename this helper",
              path: "src/workflow.ts",
              line: 12,
              user: {
                login: "copilot",
              },
            },
          ],
        ]),
      ),
    ),
    codexEditContains(
      "Review the new pull request review comments and address only valid issues.",
      (spec) => {
        reviewPrompts.push(spec.args.at(-1) ?? "");
      },
    ),
    exact(gitStatusExcludingHarness, result(" M src/workflow.ts\n")),
    exact(gitAddExcludingHarness, result()),
    exact(
      ["git", "diff", "--cached", "--stat"],
      result(" src/workflow.ts | 4 ++--\n"),
    ),
    codexOutputContains(
      "Return only a single conventional commit message line.",
      "fix: address review feedback\n",
    ),
    exact(["git", "commit", "-m", "fix: address review feedback"], result()),
    exact(["git", "push", "-u", "origin", "feature/review-loop"], result()),
    exact(["gh", "pr", "edit", "2", "--add-reviewer", "@copilot"], result()),
    exact(
      [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/pulls/2/comments",
      ],
      result(
        JSON.stringify([
          [
            {
              id: 101,
              body: "Please rename this helper",
              path: "src/workflow.ts",
              line: 12,
              user: {
                login: "copilot",
              },
            },
            {
              id: 103,
              body: "Reply in thread",
              path: "src/workflow.ts",
              line: 12,
              user: {
                login: "copilot",
              },
              in_reply_to_id: 101,
            },
            {
              id: 102,
              body: "Add a regression test",
              path: "src/workflow.test.ts",
              line: 99,
              user: {
                login: "copilot",
              },
            },
          ],
        ]),
      ),
    ),
    codexEditContains(
      "Review the new pull request review comments and address only valid issues.",
      (spec) => {
        reviewPrompts.push(spec.args.at(-1) ?? "");
      },
    ),
    exact(gitStatusExcludingHarness, result("")),
  ]);

  const workflow = await runPromptWorkflow("Implement something bigger", {
    shell,
    logger: new TestLogger(),
    harness: stubHarness(),
    sleep: async () => undefined,
    reviewPollIntervalMs: 1,
  });

  expect(workflow.reviewLoopReason).toBe("codex_no_changes");
  expect(reviewPrompts).toHaveLength(2);
  expect(reviewPrompts[0]).toContain("ID: 101");
  expect(reviewPrompts[1]).toContain("ID: 102");
  expect(reviewPrompts[1]).not.toContain("ID: 101");
  expect(reviewPrompts[1]).not.toContain("ID: 103");
  expect(
    shell.calls.filter(
      (args) => args[0] === "gh" && args[1] === "pr" && args[2] === "edit",
    ).length,
  ).toBe(2);
  shell.assertComplete();
});

it("console logger emits structured JSON lines", () => {
  const logger = new ConsoleLogger();

  expect(() => logger.info("test.event", { ok: true })).not.toThrow();
});
