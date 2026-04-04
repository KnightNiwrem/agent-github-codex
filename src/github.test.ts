import { describe, expect, it } from "bun:test";
import { GitHubClient } from "./github";
import { StubShellRunner, result } from "./test-helpers";

describe("GitHubClient.createPullRequest", () => {
  it("parses the PR payload with schema defaults", async () => {
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

  it("falls back when nullable PR fields are returned as null", async () => {
    const shell = new StubShellRunner([
      result(),
      result(
        JSON.stringify({
          number: 22,
          url: "https://example.com/pr/22",
          title: null,
          body: null,
          headRefName: null,
          baseRefName: null,
        }),
      ),
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

  it("throws an AppError when PR payload is invalid", async () => {
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
  it("parses slurped review comment pages", async () => {
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

  it("accepts null users in review comment payloads", async () => {
    const shell = new StubShellRunner([
      result(
        JSON.stringify([
          {
            id: 103,
            body: "Ghosted reviewer.",
            user: null,
          },
        ]),
      ),
    ]);
    const github = new GitHubClient(shell);

    await expect(github.listReviewComments("/repo", 22)).resolves.toEqual([
      {
        id: 103,
        body: "Ghosted reviewer.",
        path: undefined,
        line: undefined,
        userLogin: undefined,
        url: undefined,
        inReplyToId: undefined,
      },
    ]);
  });

  it("throws an AppError when review comments are malformed", async () => {
    const shell = new StubShellRunner([
      result(JSON.stringify([{ id: "bad-id", body: "comment" }])),
    ]);
    const github = new GitHubClient(shell);

    await expect(github.listReviewComments("/repo", 22)).rejects.toThrow(
      /^Failed to parse pull request review comments:/,
    );
  });
});
