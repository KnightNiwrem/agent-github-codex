import { describe, expect, test } from "bun:test";
import { GitHubClient } from "./github";
import type { CommandResult, CommandSpec, ShellRunner } from "./types";

class StubShellRunner implements ShellRunner {
  readonly calls: CommandSpec[] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    const result = this.results.shift();

    if (!result) {
      throw new Error(`Unexpected command: ${spec.args.join(" ")}`);
    }

    return result;
  }
}

function result(stdout = "", stderr = "", exitCode = 0): CommandResult {
  return {
    stdout,
    stderr,
    exitCode,
  };
}

describe("GitHubClient.createPullRequest", () => {
  test("parses the PR payload with schema defaults", async () => {
    const shell = new StubShellRunner([
      result(),
      result(JSON.stringify({ number: 22, url: "https://example.com/pr/22" })),
    ]);
    const github = new GitHubClient(shell);

    const pullRequest = await github.createPullRequest(
      "/repo",
      "main",
      "feature/zod",
      {
        title: "Refactor response parsing",
        body: "Use zod schemas.",
      },
    );

    expect(pullRequest).toEqual({
      number: 22,
      url: "https://example.com/pr/22",
      title: "Refactor response parsing",
      body: "Use zod schemas.",
      headRefName: "feature/zod",
      baseRefName: "main",
    });
  });

  test("throws an AppError when PR payload is invalid", async () => {
    const shell = new StubShellRunner([
      result(),
      result(JSON.stringify({ url: "https://example.com/pr/22" })),
    ]);
    const github = new GitHubClient(shell);

    await expect(
      github.createPullRequest("/repo", "main", "feature/zod", {
        title: "Refactor response parsing",
        body: "Use zod schemas.",
      }),
    ).rejects.toThrow(
      /^Failed to resolve pull request details after creation:/,
    );
  });
});

describe("GitHubClient.listReviewComments", () => {
  test("parses slurped review comment pages", async () => {
    const shell = new StubShellRunner([
      result(
        JSON.stringify([
          [
            {
              id: 101,
              body: "Please add coverage.",
              path: "src/github.ts",
              line: 18,
              user: { login: "reviewer" },
              html_url: "https://example.com/comment/101",
              in_reply_to_id: null,
            },
          ],
          [
            {
              id: 102,
              body: 7,
              user: { login: "reviewer-2" },
              in_reply_to_id: 101,
            },
          ],
        ]),
      ),
    ]);
    const github = new GitHubClient(shell);

    await expect(github.listReviewComments("/repo", 22)).resolves.toEqual([
      {
        id: 101,
        body: "Please add coverage.",
        path: "src/github.ts",
        line: 18,
        userLogin: "reviewer",
        url: "https://example.com/comment/101",
        inReplyToId: null,
      },
      {
        id: 102,
        body: "",
        path: undefined,
        line: undefined,
        userLogin: "reviewer-2",
        url: undefined,
        inReplyToId: 101,
      },
    ]);
  });

  test("throws an AppError when review comments are malformed", async () => {
    const shell = new StubShellRunner([
      result(JSON.stringify([{ id: "bad-id", body: "comment" }])),
    ]);
    const github = new GitHubClient(shell);

    await expect(github.listReviewComments("/repo", 22)).rejects.toThrow(
      /^Failed to parse pull request review comments:/,
    );
  });
});
