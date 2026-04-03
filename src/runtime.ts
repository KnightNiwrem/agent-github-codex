import { $ } from "bun";

import type {
  AgentLoopCodexClient,
  AgentLoopGitClient,
  AgentLoopGitHubClient,
  PullRequestDetails,
  ReviewFeedback,
} from "./agent-loop";

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const shellEscape = (value: string): string =>
  `'${value.replaceAll("'", "'\"'\"'")}'`;

const renderCommand = (command: readonly string[]): string =>
  command.map(shellEscape).join(" ");

const renderScript = (cwd: string, command: readonly string[]): string =>
  `cd ${shellEscape(cwd)} && ${renderCommand(command)}`;

class BashRunner {
  constructor(private readonly cwd: string) {}

  async run(
    command: readonly string[],
    options: { allowFailure?: boolean } = {},
  ): Promise<CommandResult> {
    const result = await $`bash -lc ${renderScript(this.cwd, command)}`
      .quiet()
      .nothrow();

    const commandResult: CommandResult = {
      exitCode: result.exitCode,
      stderr: String(result.stderr).trim(),
      stdout: String(result.stdout).trim(),
    };

    if (!options.allowFailure && commandResult.exitCode !== 0) {
      const rendered = renderCommand(command);
      throw new Error(
        `Command failed (${commandResult.exitCode}): ${rendered}\n${commandResult.stderr}`,
      );
    }

    return commandResult;
  }
}

const parseRemoteRepository = (remoteUrl: string): string => {
  const cleaned = remoteUrl.trim().replace(/\.git$/, "");
  const patterns = [
    /^git@github\.com:([^/]+\/[^/]+)$/u,
    /^https:\/\/github\.com\/([^/]+\/[^/]+)$/u,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/u,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`);
};

const createReviewBody = (body: string, state?: string): string => {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    return state ? `Review state: ${state}` : "";
  }

  return state ? `[${state}] ${trimmedBody}` : trimmedBody;
};

interface GitHubIssueComment {
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  user: {
    login: string;
  };
}

interface GitHubReview {
  body: string;
  html_url: string;
  id: number;
  state: string;
  submitted_at: string | null;
  user: {
    login: string;
  };
}

interface GitHubReviewComment {
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  user: {
    login: string;
  };
}

export class BunGitClient implements AgentLoopGitClient {
  constructor(private readonly runner: BashRunner) {}

  async checkoutNewBranch(branchName: string): Promise<void> {
    await this.runner.run(["git", "switch", "-c", branchName]);
  }

  async commitAll(message: string): Promise<void> {
    await this.runner.run(["git", "add", "-A"]);
    await this.runner.run(["git", "commit", "-m", message]);
  }

  async ensureCleanWorktree(): Promise<void> {
    const status = await this.runner.run(["git", "status", "--short"]);

    if (status.stdout) {
      throw new Error(
        [
          "The worktree must be clean before the agent loop starts.",
          "Clean or stash these changes first:",
          status.stdout,
        ].join("\n"),
      );
    }
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.runner.run([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    return result.stdout;
  }

  async getDefaultBaseBranch(): Promise<string> {
    const originHead = await this.runner.run(
      ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { allowFailure: true },
    );

    if (originHead.stdout.startsWith("origin/")) {
      return originHead.stdout.replace(/^origin\//u, "");
    }

    const hasMain = await this.hasBranch("main");
    return hasMain ? "main" : "master";
  }

  async hasBranch(branchName: string): Promise<boolean> {
    const result = await this.runner.run(
      ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      { allowFailure: true },
    );

    return result.exitCode === 0;
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.runner.run(["git", "status", "--short"]);
    return status.stdout.length > 0;
  }

  async pushBranch(branchName: string): Promise<void> {
    await this.runner.run(["git", "push", "-u", "origin", branchName]);
  }
}

export class BunCodexClient implements AgentLoopCodexClient {
  constructor(
    private readonly runner: BashRunner,
    private readonly cwd: string,
  ) {}

  async runInitial(prompt: string): Promise<void> {
    await this.runner.run([
      "codex",
      "exec",
      "--full-auto",
      "--cd",
      this.cwd,
      prompt,
    ]);
  }

  async runResume(prompt: string): Promise<void> {
    await this.runner.run([
      "codex",
      "exec",
      "resume",
      "--last",
      "--full-auto",
      prompt,
    ]);
  }
}

export class BunGitHubClient implements AgentLoopGitHubClient {
  private readonly repoSlugPromise: Promise<string>;

  constructor(private readonly runner: BashRunner) {
    this.repoSlugPromise = this.loadRepoSlug();
  }

  async createPullRequest(input: {
    base: string;
    body: string;
    branch: string;
    title: string;
  }): Promise<PullRequestDetails> {
    const createResult = await this.runner.run([
      "gh",
      "pr",
      "create",
      "--base",
      input.base,
      "--head",
      input.branch,
      "--title",
      input.title,
      "--body",
      input.body,
    ]);

    const url = createResult.stdout.trim();
    const lookup = await this.runner.run([
      "gh",
      "pr",
      "view",
      url,
      "--json",
      "number,url",
    ]);
    const parsed = JSON.parse(lookup.stdout) as PullRequestDetails;

    return parsed;
  }

  async getAuthenticatedLogin(): Promise<string | null> {
    const result = await this.runner.run(["gh", "api", "user"], {
      allowFailure: true,
    });

    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }

    const payload = JSON.parse(result.stdout) as { login?: string };
    return payload.login ?? null;
  }

  async getNewReviewFeedback(input: {
    prNumber: number;
    since: string;
    skipAuthor?: string;
  }): Promise<ReviewFeedback[]> {
    const repoSlug = await this.repoSlugPromise;
    const [issueComments, reviews, reviewComments] = await Promise.all([
      this.runner.run([
        "gh",
        "api",
        `repos/${repoSlug}/issues/${input.prNumber}/comments`,
      ]),
      this.runner.run([
        "gh",
        "api",
        `repos/${repoSlug}/pulls/${input.prNumber}/reviews`,
      ]),
      this.runner.run([
        "gh",
        "api",
        `repos/${repoSlug}/pulls/${input.prNumber}/comments`,
      ]),
    ]);

    const sinceTime = Date.parse(input.since);
    const feedback: ReviewFeedback[] = [];

    for (const comment of JSON.parse(
      issueComments.stdout,
    ) as GitHubIssueComment[]) {
      if (
        Date.parse(comment.created_at) > sinceTime &&
        comment.body.trim() &&
        comment.user.login !== input.skipAuthor
      ) {
        feedback.push({
          author: comment.user.login,
          body: comment.body,
          createdAt: comment.created_at,
          source: "issue_comment",
          url: comment.html_url,
        });
      }
    }

    for (const review of JSON.parse(reviews.stdout) as GitHubReview[]) {
      if (
        review.submitted_at &&
        Date.parse(review.submitted_at) > sinceTime &&
        review.user.login !== input.skipAuthor
      ) {
        const body = createReviewBody(review.body, review.state);

        if (body) {
          feedback.push({
            author: review.user.login,
            body,
            createdAt: review.submitted_at,
            source: "review",
            url: review.html_url,
          });
        }
      }
    }

    for (const comment of JSON.parse(
      reviewComments.stdout,
    ) as GitHubReviewComment[]) {
      if (
        Date.parse(comment.created_at) > sinceTime &&
        comment.body.trim() &&
        comment.user.login !== input.skipAuthor
      ) {
        feedback.push({
          author: comment.user.login,
          body: comment.body,
          createdAt: comment.created_at,
          source: "review_comment",
          url: comment.html_url,
        });
      }
    }

    feedback.sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );

    return feedback;
  }

  async requestCopilotReview(prNumber: number): Promise<void> {
    await this.runner.run([
      "gh",
      "pr",
      "comment",
      String(prNumber),
      "--body",
      "@copilot review",
    ]);
  }

  private async loadRepoSlug(): Promise<string> {
    const remote = await this.runner.run([
      "git",
      "remote",
      "get-url",
      "origin",
    ]);
    return parseRemoteRepository(remote.stdout);
  }
}

export const createRuntimeClients = (
  cwd: string,
): {
  codex: AgentLoopCodexClient;
  git: AgentLoopGitClient;
  github: AgentLoopGitHubClient;
} => {
  const runner = new BashRunner(cwd);

  return {
    codex: new BunCodexClient(runner, cwd),
    git: new BunGitClient(runner),
    github: new BunGitHubClient(runner),
  };
};
