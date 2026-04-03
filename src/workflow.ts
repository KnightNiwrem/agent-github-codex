import { CodexClient } from "./codex";
import {
  ALLOWED_BASE_BRANCHES,
  DEFAULT_REVIEW_POLL_INTERVAL_MS,
} from "./config";
import { AppError } from "./errors";
import { GitClient } from "./git";
import { GitHubClient } from "./github";
import type {
  Logger,
  ReviewComment,
  ReviewLoopState,
  ShellRunner,
  WorkflowResult,
} from "./types";
import { sleep as defaultSleep } from "./utils";

export interface WorkflowDependencies {
  shell: ShellRunner;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
  reviewPollIntervalMs?: number;
}

function actionableReviewComments(
  comments: ReviewComment[],
  seenCommentIds: Set<number>,
): ReviewComment[] {
  return comments.filter(
    (comment) =>
      !seenCommentIds.has(comment.id) &&
      !comment.inReplyToId &&
      comment.body.trim().length > 0,
  );
}

export async function runPromptWorkflow(
  prompt: string,
  dependencies: WorkflowDependencies,
): Promise<WorkflowResult> {
  const { shell, logger } = dependencies;
  const reviewPollIntervalMs =
    dependencies.reviewPollIntervalMs ?? DEFAULT_REVIEW_POLL_INTERVAL_MS;
  const sleep = dependencies.sleep ?? defaultSleep;
  const git = new GitClient(shell);
  const codex = new CodexClient(shell);
  const github = new GitHubClient(shell);
  const startCwd = process.cwd();
  const repoRoot = await git.getRepositoryRoot(startCwd);
  const baseBranch = await git.getCurrentBranch(repoRoot);

  logger.info("workflow.start", { repoRoot, baseBranch });

  if (!ALLOWED_BASE_BRANCHES.has(baseBranch)) {
    throw new AppError(
      "Current branch must be main or master before running this CLI.",
    );
  }

  await git.ensureCleanWorkspace(repoRoot);

  const branch = await codex.generateBranchName(repoRoot, prompt);
  logger.info("branch.selected", { branch, baseBranch });

  const isValidBranch = await git.validateBranchName(repoRoot, branch);

  if (!isValidBranch) {
    throw new AppError(`Generated branch name is invalid: ${branch}`);
  }

  await git.createBranch(repoRoot, branch, baseBranch);
  logger.info("branch.created", { branch });

  await codex.implementPrompt(repoRoot, prompt);
  logger.info("codex.implementation.complete", { branch });

  const hasInitialChanges = await git.hasChanges(repoRoot);

  if (!hasInitialChanges) {
    logger.info("workflow.no_initial_changes", { branch });

    return {
      branch,
      baseBranch,
      committed: false,
      reviewLoopReason: "no_initial_changes",
    };
  }

  await git.stageAll(repoRoot);
  const stagedDiff = await git.getStagedDiff(repoRoot);
  const commitMessage = await codex.generateCommitMessage(
    repoRoot,
    prompt,
    stagedDiff,
    "implementation",
  );

  await git.commit(repoRoot, commitMessage);
  await git.push(repoRoot, branch);
  logger.info("git.pushed", { branch, commitMessage });

  const branchDiff = await git.getBranchDiff(repoRoot, baseBranch);
  const draft = await codex.generatePullRequestDraft(
    repoRoot,
    prompt,
    branch,
    baseBranch,
    branchDiff,
  );
  const pullRequest = await github.createPullRequest(
    repoRoot,
    baseBranch,
    branch,
    draft,
  );
  logger.info("pr.created", {
    number: pullRequest.number,
    url: pullRequest.url,
  });

  await github.requestCopilotReview(repoRoot, pullRequest.number);
  logger.info("pr.review_requested", {
    number: pullRequest.number,
    reviewer: "@copilot",
  });

  const reviewState: ReviewLoopState = {
    seenCommentIds: new Set<number>(),
  };
  const reviewLoopReason = await runReviewLoop({
    prompt,
    repoRoot,
    branch,
    pullRequestNumber: pullRequest.number,
    git,
    github,
    codex,
    logger,
    sleep,
    reviewPollIntervalMs,
    reviewState,
  });

  return {
    branch,
    baseBranch,
    committed: true,
    pr: pullRequest,
    reviewLoopReason,
  };
}

interface ReviewLoopArgs {
  prompt: string;
  repoRoot: string;
  branch: string;
  pullRequestNumber: number;
  git: GitClient;
  github: GitHubClient;
  codex: CodexClient;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  reviewPollIntervalMs: number;
  reviewState: ReviewLoopState;
}

async function runReviewLoop(
  args: ReviewLoopArgs,
): Promise<WorkflowResult["reviewLoopReason"]> {
  const {
    prompt,
    repoRoot,
    branch,
    pullRequestNumber,
    git,
    github,
    codex,
    logger,
    sleep,
    reviewPollIntervalMs,
    reviewState,
  } = args;

  while (true) {
    logger.info("review.waiting", { pullRequestNumber, reviewPollIntervalMs });
    await sleep(reviewPollIntervalMs);

    const comments = await github.listReviewComments(
      repoRoot,
      pullRequestNumber,
    );
    const actionable = actionableReviewComments(
      comments,
      reviewState.seenCommentIds,
    );

    if (actionable.length === 0) {
      logger.info("review.no_new_actionable_comments", { pullRequestNumber });
      return "no_new_actionable_comments";
    }

    for (const comment of actionable) {
      reviewState.seenCommentIds.add(comment.id);
    }
    logger.info("review.comments_received", {
      pullRequestNumber,
      count: actionable.length,
      commentIds: actionable.map((comment) => comment.id).join(","),
    });

    await codex.addressReviewComments(repoRoot, prompt, actionable);

    if (!(await git.hasChanges(repoRoot))) {
      logger.info("review.codex_no_changes", { pullRequestNumber });
      return "codex_no_changes";
    }

    await git.stageAll(repoRoot);
    const stagedDiff = await git.getStagedDiff(repoRoot);
    const commitMessage = await codex.generateCommitMessage(
      repoRoot,
      prompt,
      stagedDiff,
      "review",
    );
    await git.commit(repoRoot, commitMessage);
    await git.push(repoRoot, branch);
    logger.info("review.fix_pushed", {
      pullRequestNumber,
      branch,
      commitMessage,
    });

    await github.requestCopilotReview(repoRoot, pullRequestNumber);
    logger.info("review.re_requested", {
      pullRequestNumber,
      reviewer: "@copilot",
    });
  }
}
