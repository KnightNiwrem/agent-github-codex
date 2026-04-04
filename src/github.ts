import { ZodError, z } from "zod";
import type {
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
  line: z.number().optional(),
  user: z
    .object({
      login: z.string(),
    })
    .nullish(),
  html_url: z.string().optional(),
  in_reply_to_id: z.number().nullable().optional(),
});

const reviewCommentPageSchema = z.array(reviewCommentPayloadSchema);
type ReviewCommentPayload = z.infer<typeof reviewCommentPayloadSchema>;

function flattenReviewCommentPayload(
  payload: ReviewCommentPayload[] | ReviewCommentPayload[][],
): ReviewCommentPayload[] {
  const firstItem = payload[0];

  if (Array.isArray(firstItem)) {
    return payload.flat();
  }

  return payload as ReviewCommentPayload[];
}

const reviewCommentPagesSchema = z
  .union([reviewCommentPageSchema, z.array(reviewCommentPageSchema)])
  .transform((payload) => flattenReviewCommentPayload(payload))
  .transform((comments): ReviewComment[] =>
    comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      userLogin: comment.user?.login,
      url: comment.html_url,
      inReplyToId: comment.in_reply_to_id,
    })),
  );

function parseGitHubJson<T>(
  stdout: string,
  schema: z.ZodType<T>,
  errorPrefix: string,
): T {
  try {
    return schema.parse(JSON.parse(stdout));
  } catch (error) {
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
    const payload = parseGitHubJson(
      result.stdout,
      pullRequestViewSchema,
      "Failed to resolve pull request details after creation",
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
      result.stdout,
      viewerSchema,
      "Failed to parse authenticated GitHub user",
    );

    return payload.login;
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
    return parseGitHubJson(
      result.stdout,
      reviewCommentPagesSchema,
      "Failed to parse pull request review comments",
    );
  }
}
