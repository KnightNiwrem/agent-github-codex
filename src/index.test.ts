import { describe, expect, test } from "bun:test";

import type {
  AgentLoopDependencies,
  AgentLoopOptions,
  PullRequestDetails,
  ReviewFeedback,
} from "./agent-loop";
import { createBranchName, runAgentLoop, summarizePrompt } from "./agent-loop";
import { parsePrompt, parseReviewWaitMinutes } from "./cli";

const createOptions = (prompt: string): AgentLoopOptions => ({
  branchPrefix: "feature",
  commitPrefix: "feat",
  logger: { info: () => undefined },
  prompt,
  reviewWaitMinutes: 10,
  sleep: async () => undefined,
});

const createDependencies = (input: {
  currentBranch: string;
  feedbackBatches?: ReviewFeedback[][];
  hasChangesSequence: boolean[];
}): AgentLoopDependencies & {
  state: {
    codexInitialPrompts: string[];
    codexResumePrompts: string[];
    commits: string[];
    createdBranches: string[];
    pushedBranches: string[];
    requestedReviews: number[];
  };
} => {
  let hasChangesCalls = 0;
  let feedbackCalls = 0;

  const state = {
    codexInitialPrompts: [] as string[],
    codexResumePrompts: [] as string[],
    commits: [] as string[],
    createdBranches: [] as string[],
    pushedBranches: [] as string[],
    requestedReviews: [] as number[],
  };

  return {
    codex: {
      runInitial: async (prompt) => {
        state.codexInitialPrompts.push(prompt);
      },
      runResume: async (prompt) => {
        state.codexResumePrompts.push(prompt);
      },
    },
    git: {
      checkoutNewBranch: async (branchName) => {
        state.createdBranches.push(branchName);
      },
      commitAll: async (message) => {
        state.commits.push(message);
      },
      ensureCleanWorktree: async () => undefined,
      getCurrentBranch: async () => input.currentBranch,
      getDefaultBaseBranch: async () => "main",
      hasBranch: async () => false,
      hasChanges: async () => {
        const index = hasChangesCalls;
        hasChangesCalls += 1;
        return input.hasChangesSequence[index] ?? false;
      },
      pushBranch: async (branchName) => {
        state.pushedBranches.push(branchName);
      },
    },
    github: {
      createPullRequest: async (): Promise<PullRequestDetails> => ({
        number: 12,
        url: "https://github.com/example/repo/pull/12",
      }),
      getAuthenticatedLogin: async () => "automation-bot",
      getNewReviewFeedback: async () => {
        const batch = input.feedbackBatches?.[feedbackCalls] ?? [];
        feedbackCalls += 1;
        return batch;
      },
      requestCopilotReview: async (prNumber) => {
        state.requestedReviews.push(prNumber);
      },
    },
    state,
  };
};

describe("agent loop helpers", () => {
  test("createBranchName slugifies the prompt", () => {
    expect(createBranchName("feature", "Fix CI + PR loop")).toBe(
      "feature/fix-ci-pr-loop",
    );
  });

  test("parsePrompt joins argv into a single prompt", () => {
    expect(parsePrompt(["Implement", "the", "loop"])).toBe(
      "Implement the loop",
    );
  });

  test("parseReviewWaitMinutes defaults to 10", () => {
    expect(parseReviewWaitMinutes(undefined)).toBe(10);
  });

  test("summarizePrompt truncates long prompts", () => {
    expect(summarizePrompt("a".repeat(100), 10)).toBe("aaaaaaa...");
  });
});

describe("runAgentLoop", () => {
  test("creates a feature branch, opens a PR, and handles a review-driven fix", async () => {
    const dependencies = createDependencies({
      currentBranch: "main",
      feedbackBatches: [
        [
          {
            id: "review-comment-1",
            author: "copilot-pull-request-reviewer[bot]",
            body: "Please add a stricter guard around branch creation.",
            createdAt: "2026-04-03T00:10:00.000Z",
            source: "review_comment",
            url: "https://github.com/example/repo/pull/12#discussion_r1",
          },
        ],
        [],
      ],
      hasChangesSequence: [true, true],
    });

    const result = await runAgentLoop(
      createOptions("Implement the deterministic PR review harness"),
      dependencies,
    );

    expect(result).toEqual({
      branchName: "feature/implement-the-deterministic-pr-review-harness",
      commitsCreated: 2,
      pullRequestUrl: "https://github.com/example/repo/pull/12",
      reviewCycles: 1,
      status: "completed",
    });
    expect(dependencies.state.createdBranches).toEqual([
      "feature/implement-the-deterministic-pr-review-harness",
    ]);
    expect(dependencies.state.commits).toEqual([
      "feat: Implement the deterministic PR review harness",
      "fix: address automated PR feedback (1)",
    ]);
    expect(dependencies.state.pushedBranches).toEqual([
      "feature/implement-the-deterministic-pr-review-harness",
      "feature/implement-the-deterministic-pr-review-harness",
    ]);
    expect(dependencies.state.requestedReviews).toEqual([12, 12]);
    expect(dependencies.state.codexResumePrompts[0]).toContain(
      "Please add a stricter guard around branch creation.",
    );
  });

  test("skips PR creation when codex makes no changes", async () => {
    const dependencies = createDependencies({
      currentBranch: "feature/already-here",
      hasChangesSequence: [false],
    });

    const result = await runAgentLoop(
      createOptions("Document the harness behavior"),
      dependencies,
    );

    expect(result).toEqual({
      branchName: "feature/already-here",
      commitsCreated: 0,
      pullRequestUrl: null,
      reviewCycles: 0,
      status: "no_changes",
    });
    expect(dependencies.state.commits).toHaveLength(0);
    expect(dependencies.state.requestedReviews).toHaveLength(0);
  });

  test("stops after review validation when codex does not create new fixes", async () => {
    const dependencies = createDependencies({
      currentBranch: "feature/already-here",
      feedbackBatches: [
        [
          {
            id: "review-1",
            author: "copilot-pull-request-reviewer[bot]",
            body: "Nit: this is already handled.",
            createdAt: "2026-04-03T00:10:00.000Z",
            source: "review",
            url: "https://github.com/example/repo/pull/12#pullrequestreview-1",
          },
        ],
      ],
      hasChangesSequence: [true, false],
    });

    const result = await runAgentLoop(
      createOptions("Implement the loop"),
      dependencies,
    );

    expect(result.commitsCreated).toBe(1);
    expect(result.reviewCycles).toBe(1);
    expect(dependencies.state.commits).toEqual(["feat: Implement the loop"]);
    expect(dependencies.state.requestedReviews).toEqual([12]);
  });
});
