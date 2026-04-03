import { CodexClient } from "./codex";
import {
  ALLOWED_BASE_BRANCHES,
  DEFAULT_REVIEW_POLL_INTERVAL_MS,
} from "./config";
import { AppError } from "./errors";
import { GitClient } from "./git";
import { GitHubClient } from "./github";
import type { HarnessWorkspaceState } from "./harness";
import { FileSystemHarnessWorkspace } from "./harness";
import type {
  Logger,
  ReviewComment,
  ReviewLoopState,
  ShellRunner,
  WorkflowOptions,
  WorkflowResult,
} from "./types";
import { sleep as defaultSleep } from "./utils";

export interface WorkflowDependencies {
  shell: ShellRunner;
  logger: Logger;
  harness?: {
    ensure(repoRoot: string): Promise<HarnessWorkspaceState>;
  };
  sleep?: (ms: number) => Promise<void>;
  reviewPollIntervalMs?: number;
  options?: WorkflowOptions;
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
  const maxUnproductivePolls = dependencies.options?.maxUnproductivePolls ?? 1;
  const git = new GitClient(shell);
  const codex = new CodexClient(shell);
  const github = new GitHubClient(shell);
  const harness = dependencies.harness ?? new FileSystemHarnessWorkspace();
  const startCwd = process.cwd();
  const repoRoot = await git.getRepositoryRoot(startCwd);
  const harnessState = await harness.ensure(repoRoot);
  const baseBranch = await git.getCurrentBranch(repoRoot);

  logger.info("workflow.start", {
    repoRoot,
    baseBranch,
    agcDir: harnessState.rootDir,
    reviewers: harnessState.config.pullRequestReviewers.join(","),
  });

  if (!ALLOWED_BASE_BRANCHES.has(baseBranch)) {
    throw new AppError(
      "Current branch must be main or master before running this CLI.",
    );
  }

  await git.ensureCleanWorkspace(repoRoot);

  const branch = await codex.generateBranchName(
    repoRoot,
    prompt,
    harnessState.stateDir,
  );
  logger.info("branch.selected", { branch, baseBranch });

  await git.createBranch(repoRoot, branch, baseBranch);
  logger.info("branch.created", { branch });

  await codex.implementPrompt(repoRoot, prompt);
  logger.info("codex.implementation.complete", { branch });

  const hasInitialChanges = await git.hasChanges(repoRoot);

  if (!hasInitialChanges) {
    logger.info("workflow.no_initial_changes", {
      branch,
      message: "No file changes were produced; returning to the base branch.",
    });
    await git.checkoutBranch(repoRoot, baseBranch);
    logger.info("branch.restored", {
      branch: baseBranch,
      reason: "no_initial_changes",
    });

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
    harnessState.stateDir,
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
    harnessState.stateDir,
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

  await github.requestReviewers(
    repoRoot,
    pullRequest.number,
    harnessState.config.pullRequestReviewers,
  );
  logger.info("pr.review_requested", {
    number: pullRequest.number,
    reviewers: harnessState.config.pullRequestReviewers.join(","),
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
    maxUnproductivePolls,
    reviewState,
    stateDir: harnessState.stateDir,
    reviewers: harnessState.config.pullRequestReviewers,
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
  maxUnproductivePolls: number;
  reviewState: ReviewLoopState;
  stateDir: string;
  reviewers: string[];
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
    maxUnproductivePolls,
    reviewState,
    stateDir,
    reviewers,
  } = args;
  let consecutiveUnproductivePolls = 0;

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
      consecutiveUnproductivePolls += 1;
      logger.info("review.no_new_actionable_comments", {
        pullRequestNumber,
        consecutiveUnproductivePolls,
        maxUnproductivePolls,
      });

      if (
        maxUnproductivePolls !== 0 &&
        consecutiveUnproductivePolls >= maxUnproductivePolls
      ) {
        return "no_new_actionable_comments";
      }

      continue;
    }

    consecutiveUnproductivePolls = 0;

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
      stateDir,
    );
    await git.commit(repoRoot, commitMessage);
    await git.push(repoRoot, branch);
    logger.info("review.fix_pushed", {
      pullRequestNumber,
      branch,
      commitMessage,
    });

    await github.requestReviewers(repoRoot, pullRequestNumber, reviewers);
    logger.info("review.re_requested", {
      pullRequestNumber,
      reviewers: reviewers.join(","),
    });
  }
}
