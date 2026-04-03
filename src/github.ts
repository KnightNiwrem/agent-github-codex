import { AppError } from "./errors";
import type {
  PullRequestDraft,
  PullRequestInfo,
  ReviewComment,
  ShellRunner,
} from "./types";

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as T[];
}

function normalizeComments(payload: unknown): ReviewComment[] {
  const pages = asArray<unknown>(payload);
  const rawComments = Array.isArray(pages[0])
    ? pages.flatMap((page) => asArray<Record<string, unknown>>(page))
    : asArray<Record<string, unknown>>(payload);

  return rawComments
    .map((comment): ReviewComment | null => {
      const id = typeof comment.id === "number" ? comment.id : null;

      if (!id) {
        return null;
      }

      return {
        id,
        body: typeof comment.body === "string" ? comment.body : "",
        path: typeof comment.path === "string" ? comment.path : undefined,
        line: typeof comment.line === "number" ? comment.line : undefined,
        userLogin:
          comment.user &&
          typeof comment.user === "object" &&
          "login" in comment.user
            ? String(comment.user.login)
            : undefined,
        url:
          typeof comment.html_url === "string" ? comment.html_url : undefined,
        inReplyToId:
          typeof comment.in_reply_to_id === "number"
            ? comment.in_reply_to_id
            : undefined,
      };
    })
    .filter((comment): comment is ReviewComment => comment !== null);
}

export class GitHubClient {
  constructor(private readonly shell: ShellRunner) {}

  async createPullRequest(
    cwd: string,
    baseBranch: string,
    headBranch: string,
    draft: PullRequestDraft,
  ): Promise<PullRequestInfo> {
    await this.shell.run({
      args: [
        "gh",
        "pr",
        "create",
        "--base",
        baseBranch,
        "--head",
        headBranch,
        "--title",
        draft.title,
        "--body",
        draft.body,
      ],
      cwd,
    });

    const result = await this.shell.run({
      args: [
        "gh",
        "pr",
        "view",
        headBranch,
        "--json",
        "number,url,title,body,headRefName,baseRefName",
      ],
      cwd,
    });
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    const number = typeof payload.number === "number" ? payload.number : null;
    const url = typeof payload.url === "string" ? payload.url : null;
    const title =
      typeof payload.title === "string" ? payload.title : draft.title;
    const body = typeof payload.body === "string" ? payload.body : draft.body;
    const resolvedHead =
      typeof payload.headRefName === "string"
        ? payload.headRefName
        : headBranch;
    const resolvedBase =
      typeof payload.baseRefName === "string"
        ? payload.baseRefName
        : baseBranch;

    if (!number || !url) {
      throw new AppError(
        "Failed to resolve pull request details after creation.",
      );
    }

    return {
      number,
      url,
      title,
      body,
      headRefName: resolvedHead,
      baseRefName: resolvedBase,
    };
  }

  async requestReviewers(
    cwd: string,
    pullRequestNumber: number,
    reviewers: string[],
  ): Promise<void> {
    for (const reviewer of reviewers) {
      await this.shell.run({
        args: [
          "gh",
          "pr",
          "edit",
          String(pullRequestNumber),
          "--add-reviewer",
          reviewer,
        ],
        cwd,
      });
    }
  }

  async listReviewComments(
    cwd: string,
    pullRequestNumber: number,
  ): Promise<ReviewComment[]> {
    const result = await this.shell.run({
      args: [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        `repos/{owner}/{repo}/pulls/${pullRequestNumber}/comments`,
      ],
      cwd,
    });
    const payload = JSON.parse(result.stdout) as unknown;

    return normalizeComments(payload);
  }
}
