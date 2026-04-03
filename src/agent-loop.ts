export interface ReviewFeedback {
  author: string;
  body: string;
  createdAt: string;
  source: "issue_comment" | "review" | "review_comment";
  url: string;
}

export interface PullRequestDetails {
  number: number;
  url: string;
}

export interface AgentLoopLogger {
  info(message: string): void;
}

export interface AgentLoopGitClient {
  checkoutNewBranch(branchName: string): Promise<void>;
  commitAll(message: string): Promise<void>;
  ensureCleanWorktree(): Promise<void>;
  getCurrentBranch(): Promise<string>;
  getDefaultBaseBranch(): Promise<string>;
  hasBranch(branchName: string): Promise<boolean>;
  hasChanges(): Promise<boolean>;
  pushBranch(branchName: string): Promise<void>;
}

export interface AgentLoopCodexClient {
  runInitial(prompt: string): Promise<void>;
  runResume(prompt: string): Promise<void>;
}

export interface AgentLoopGitHubClient {
  createPullRequest(input: {
    base: string;
    body: string;
    branch: string;
    title: string;
  }): Promise<PullRequestDetails>;
  getAuthenticatedLogin(): Promise<string | null>;
  getNewReviewFeedback(input: {
    prNumber: number;
    since: string;
    skipAuthor?: string;
  }): Promise<ReviewFeedback[]>;
  requestCopilotReview(prNumber: number): Promise<void>;
}

export type AgentLoopSleep = (milliseconds: number) => Promise<void>;

export interface AgentLoopOptions {
  branchPrefix: string;
  commitPrefix: string;
  logger: AgentLoopLogger;
  prompt: string;
  reviewWaitMinutes: number;
  sleep: AgentLoopSleep;
}

export interface AgentLoopDependencies {
  codex: AgentLoopCodexClient;
  git: AgentLoopGitClient;
  github: AgentLoopGitHubClient;
}

export interface AgentLoopResult {
  branchName: string;
  commitsCreated: number;
  pullRequestUrl: string | null;
  reviewCycles: number;
  status: "completed" | "no_changes";
}

export const createBranchName = (prefix: string, prompt: string): string => {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${prefix}/${slug || "update"}`;
};

export const summarizePrompt = (prompt: string, maxLength = 72): string => {
  const singleLine = prompt.replace(/\s+/g, " ").trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
};

const buildInitialCommitMessage = (
  commitPrefix: string,
  prompt: string,
): string => `${commitPrefix}: ${summarizePrompt(prompt, 60)}`;

const buildPullRequestBody = (prompt: string): string =>
  [
    "## Summary",
    "",
    "Automated implementation produced by the Bun agent loop.",
    "",
    "## Original Prompt",
    "",
    "```text",
    prompt.trim(),
    "```",
  ].join("\n");

const buildReviewPrompt = (feedback: ReviewFeedback[]): string => {
  const renderedFeedback = feedback
    .map((comment, index) =>
      [
        `${index + 1}. ${comment.source} from ${comment.author} at ${comment.createdAt}`,
        `URL: ${comment.url}`,
        comment.body.trim(),
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "Continue the current Codex session for this pull request.",
    "Validate each new review item before changing code.",
    "Apply fixes only for valid issues that still need changes.",
    "Do not make speculative edits for invalid, outdated, or already-resolved feedback.",
    "",
    "New pull request feedback:",
    renderedFeedback,
  ].join("\n");
};

const latestTimestamp = (
  feedback: ReviewFeedback[],
  fallback: string,
): string => {
  let latest = fallback;

  for (const item of feedback) {
    if (Date.parse(item.createdAt) > Date.parse(latest)) {
      latest = item.createdAt;
    }
  }

  return latest;
};

const sleepDurationMinutesToMilliseconds = (minutes: number): number =>
  Math.round(minutes * 60_000);

const resolveBranchName = async (
  git: AgentLoopGitClient,
  baseBranchName: string,
): Promise<string> => {
  let candidate = baseBranchName;
  let suffix = 2;

  while (await git.hasBranch(candidate)) {
    candidate = `${baseBranchName}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

export const runAgentLoop = async (
  options: AgentLoopOptions,
  dependencies: AgentLoopDependencies,
): Promise<AgentLoopResult> => {
  const { codex, git, github } = dependencies;
  const {
    branchPrefix,
    commitPrefix,
    logger,
    prompt,
    reviewWaitMinutes,
    sleep,
  } = options;

  await git.ensureCleanWorktree();

  const currentBranch = await git.getCurrentBranch();
  const baseBranch = await git.getDefaultBaseBranch();
  let branchName = currentBranch;

  if (currentBranch === "main" || currentBranch === "master") {
    const requestedBranchName = createBranchName(branchPrefix, prompt);
    branchName = await resolveBranchName(git, requestedBranchName);
    logger.info(`Checking out feature branch ${branchName}`);
    await git.checkoutNewBranch(branchName);
  }

  logger.info("Running codex for the initial implementation pass");
  await codex.runInitial(prompt);

  if (!(await git.hasChanges())) {
    logger.info("Codex did not produce any file changes; skipping PR creation");
    return {
      branchName,
      commitsCreated: 0,
      pullRequestUrl: null,
      reviewCycles: 0,
      status: "no_changes",
    };
  }

  const pullRequestTitle = buildInitialCommitMessage(commitPrefix, prompt);
  await git.commitAll(pullRequestTitle);
  await git.pushBranch(branchName);

  logger.info("Opening a pull request");
  const pullRequest = await github.createPullRequest({
    base: baseBranch,
    body: buildPullRequestBody(prompt),
    branch: branchName,
    title: pullRequestTitle,
  });

  let commitsCreated = 1;
  let reviewCycles = 0;
  let lastSeenFeedbackAt = new Date().toISOString();
  const authenticatedLogin = await github.getAuthenticatedLogin();

  while (true) {
    logger.info(
      `Waiting ${reviewWaitMinutes} minute(s) before checking for review feedback`,
    );
    await sleep(sleepDurationMinutesToMilliseconds(reviewWaitMinutes));

    const feedback = await github.getNewReviewFeedback({
      prNumber: pullRequest.number,
      since: lastSeenFeedbackAt,
      skipAuthor: authenticatedLogin ?? undefined,
    });

    if (feedback.length === 0) {
      logger.info("No new automated review feedback was found");
      break;
    }

    lastSeenFeedbackAt = latestTimestamp(feedback, lastSeenFeedbackAt);
    reviewCycles += 1;

    logger.info(`Running codex against ${feedback.length} new review item(s)`);
    await codex.runResume(buildReviewPrompt(feedback));

    if (!(await git.hasChanges())) {
      logger.info("Codex did not create follow-up changes; finishing the loop");
      break;
    }

    await git.commitAll(`fix: address automated PR feedback (${reviewCycles})`);
    await git.pushBranch(branchName);
    commitsCreated += 1;

    logger.info("Requesting a fresh Copilot review");
    await github.requestCopilotReview(pullRequest.number);
  }

  return {
    branchName,
    commitsCreated,
    pullRequestUrl: pullRequest.url,
    reviewCycles,
    status: "completed",
  };
};
