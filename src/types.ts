export interface CommandSpec {
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  allowFailure?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export interface JsonArray extends Array<JsonValue> {}
export type LogFields = JsonObject;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface PullRequestDraft {
  title: string;
  body: string;
}

export interface PullRequestInfo extends PullRequestDraft {
  number: number;
  url: string;
  headRefName: string;
  baseRefName: string;
}

export interface ReviewComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  userLogin?: string;
  url?: string;
  inReplyToId?: number | null;
}

export interface WorkflowResult {
  branch: string;
  baseBranch: string;
  committed: boolean;
  pr?: PullRequestInfo;
  reviewLoopReason?:
    | "no_initial_changes"
    | "no_new_actionable_comments"
    | "codex_no_changes";
}

export interface ReviewLoopState {
  seenCommentIds: Set<number>;
  ignoredCommentIds: Set<number>;
}

export interface WorkflowOptions {
  maxUnproductivePolls?: number;
}

export interface HarnessConfig {
  pullRequestReviewers: string[];
  trustedReviewCommenters: string[];
}
