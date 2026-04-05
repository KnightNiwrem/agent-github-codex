import { ZodError, z } from "zod";
import type {
  JsonObject,
  JsonValue,
  Logger,
  PullRequestDraft,
  PullRequestInfo,
  ReviewComment,
  ShellRunner,
} from "./types";
import { formatZodError } from "./zod-utils";

const pullRequestViewSchema = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string().nullish(),
  body: z.string().nullish(),
  headRefName: z.string().nullish(),
  baseRefName: z.string().nullish(),
});

const viewerSchema = z.object({
  login: z.string(),
});

const reviewCommentPayloadSchema = z.object({
  id: z.number(),
  body: z.string().catch(""),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  user: z
    .object({
      login: z.string(),
    })
    .nullish(),
  html_url: z.string().optional(),
  in_reply_to_id: z.number().nullable().optional(),
});

const issueCommentPayloadSchema = z.object({
  id: z.number(),
  body: z.string().catch(""),
  user: z
    .object({
      login: z.string(),
    })
    .nullish(),
  html_url: z.string().optional(),
});

const reviewCommentPageSchema = z.array(reviewCommentPayloadSchema);
const issueCommentPageSchema = z.array(issueCommentPayloadSchema);

function flattenSlurpedPages<T>(payload: T[] | T[][]): T[] {
  const firstItem = payload[0];

  if (Array.isArray(firstItem)) {
    return (payload as T[][]).flat();
  }

  return payload as T[];
}

const reviewCommentPagesSchema = z
  .union([reviewCommentPageSchema, z.array(reviewCommentPageSchema)])
  .transform((payload) => flattenSlurpedPages(payload))
  .transform((comments): ReviewComment[] =>
    comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line ?? undefined,
      userLogin: comment.user?.login,
      url: comment.html_url,
      inReplyToId: comment.in_reply_to_id ?? undefined,
    })),
  );

const issueCommentPagesSchema = z
  .union([issueCommentPageSchema, z.array(issueCommentPageSchema)])
  .transform((payload) => flattenSlurpedPages(payload))
  .transform((comments): ReviewComment[] =>
    comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      path: undefined,
      line: undefined,
      userLogin: comment.user?.login,
      url: comment.html_url,
      inReplyToId: undefined,
    })),
  );

function parseGitHubJson<T>(
  logger: Logger | undefined,
  stdout: string,
  schema: z.ZodType<T>,
  errorPrefix: string,
  details?: JsonObject,
): T {
  logger?.info("parse.github.response_received", {
    errorPrefix,
    ...(details ?? {}),
    stdout,
  });

  try {
    const parsed = schema.parse(JSON.parse(stdout));
    logger?.info("parse.github.response_parsed", {
      errorPrefix,
      ...(details ?? {}),
      result: parsed as unknown as JsonValue,
    });

    return parsed;
  } catch (error) {
    const errorMessage =
      error instanceof ZodError
        ? formatZodError(error, { singleLine: true })
        : error instanceof Error
          ? error.message
          : String(error);
    const issues =
      error instanceof ZodError
        ? error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join("."),
            message: issue.message,
          }))
        : undefined;

    logger?.error("parse.github.response_failed", {
      errorPrefix,
      ...(details ?? {}),
      stdout,
      error: errorMessage,
      issues,
    });

    if (error instanceof SyntaxError) {
      throw new Error(`${errorPrefix}: invalid JSON response.`);
    }

    if (error instanceof ZodError) {
      throw new Error(
        `${errorPrefix}: ${formatZodError(error, { singleLine: true })}`,
      );
    }

    throw error;
  }
}

export class GitHubClient {
  constructor(
    private readonly shell: ShellRunner,
    private readonly logger?: Logger,
  ) {}

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
    const payload = parseGitHubJson(
      this.logger,
      result.stdout,
      pullRequestViewSchema,
      "Failed to resolve pull request details after creation",
      {
        operation: "createPullRequest",
        headBranch,
        baseBranch,
      },
    );

    return {
      number: payload.number,
      url: payload.url,
      title: payload.title ?? draft.title,
      body: payload.body ?? draft.body,
      headRefName: payload.headRefName ?? headBranch,
      baseRefName: payload.baseRefName ?? baseBranch,
    };
  }

  async requestReviewers(
    cwd: string,
    pullRequestNumber: number,
    reviewers: string[],
  ): Promise<void> {
    if (reviewers.length === 0) {
      return;
    }

    await this.shell.run({
      args: [
        "gh",
        "pr",
        "edit",
        String(pullRequestNumber),
        "--add-reviewer",
        reviewers.join(","),
      ],
      cwd,
    });
  }

  async getCurrentUserLogin(cwd: string): Promise<string> {
    const result = await this.shell.run({
      args: ["gh", "api", "user"],
      cwd,
    });
    const payload = parseGitHubJson(
      this.logger,
      result.stdout,
      viewerSchema,
      "Failed to parse authenticated GitHub user",
      {
        operation: "getCurrentUserLogin",
      },
    );

    return payload.login;
  }

  async listReviewComments(
    cwd: string,
    pullRequestNumber: number,
  ): Promise<ReviewComment[]> {
    // This combines inline review comments and top-level PR conversation comments.
    const reviewResult = await this.shell.run({
      args: [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        `repos/{owner}/{repo}/pulls/${pullRequestNumber}/comments`,
      ],
      cwd,
    });
    const issueResult = await this.shell.run({
      args: [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        `repos/{owner}/{repo}/issues/${pullRequestNumber}/comments`,
      ],
      cwd,
    });

    const reviewComments = parseGitHubJson(
      this.logger,
      reviewResult.stdout,
      reviewCommentPagesSchema,
      "Failed to parse pull request review comments",
      {
        operation: "listReviewComments",
        pullRequestNumber,
      },
    );
    const issueComments = parseGitHubJson(
      this.logger,
      issueResult.stdout,
      issueCommentPagesSchema,
      "Failed to parse pull request conversation comments",
      {
        operation: "listReviewComments",
        pullRequestNumber,
      },
    );

    return [...reviewComments, ...issueComments].sort(
      (left, right) => left.id - right.id,
    );
  }
}
