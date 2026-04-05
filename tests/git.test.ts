import { describe, expect, it } from "bun:test";
import { GitClient, runGitCommand, runGitTextCommand } from "../src/git";
import { StubShellRunner, result } from "./test-helpers";

describe("GitClient workspace status", () => {
  it("ignores harness paths when checking for a clean workspace", async () => {
    const shell = new StubShellRunner([result()]);
    const git = new GitClient(shell);

    await expect(git.ensureCleanWorkspace("/repo")).resolves.toBeUndefined();
    expect(shell.calls).toEqual([
      {
        args: ["git", "status", "--porcelain", "--", ".", ":(exclude).agc"],
        cwd: "/repo",
      },
    ]);
  });

  it("throws when tracked workspace changes are present", async () => {
    const shell = new StubShellRunner([result(" M src/git.ts\n")]);
    const git = new GitClient(shell);

    await expect(git.ensureCleanWorkspace("/repo")).rejects.toThrow(
      "Workspace must be clean before running this CLI.",
    );
  });

  it("reuses the shared workspace status command for hasChanges", async () => {
    const shell = new StubShellRunner([result("?? src/git.test.ts\n")]);
    const git = new GitClient(shell);

    await expect(git.hasChanges("/repo")).resolves.toBeTrue();
    expect(shell.calls).toEqual([
      {
        args: ["git", "status", "--porcelain", "--", ".", ":(exclude).agc"],
        cwd: "/repo",
      },
    ]);
  });
});

describe("GitClient git command helpers", () => {
  it("forwards command options through the shared git runner", async () => {
    const shell = new StubShellRunner([result("ok")]);

    await expect(
      runGitCommand(shell, "/repo", ["status", "--short"], {
        env: { FOO: "bar" },
        input: "data",
        allowFailure: true,
      }),
    ).resolves.toEqual(result("ok"));

    expect(shell.calls).toEqual([
      {
        args: ["git", "status", "--short"],
        cwd: "/repo",
        env: { FOO: "bar" },
        input: "data",
        allowFailure: true,
      },
    ]);
  });

  it("trims stdout through the shared text runner", async () => {
    const shell = new StubShellRunner([result(" value \n")]);

    await expect(
      runGitTextCommand(shell, "/repo", ["rev-parse", "--show-toplevel"]),
    ).resolves.toBe("value");

    expect(shell.calls).toEqual([
      {
        args: ["git", "rev-parse", "--show-toplevel"],
        cwd: "/repo",
      },
    ]);
  });

  it("prefixes standard commands through the shared git runner", async () => {
    const shell = new StubShellRunner([
      result(" /repo \n"),
      result(" main \n"),
      result(" .git/hooks/pre-commit \n"),
      result(),
      result(),
      result(),
      result(),
      result(" staged stat \n"),
      result(" branch stat \n"),
      result(),
      result(),
    ]);
    const git = new GitClient(shell);

    await expect(git.getRepositoryRoot("/repo")).resolves.toBe("/repo");
    await expect(git.getCurrentBranch("/repo")).resolves.toBe("main");
    await expect(git.getGitPath("/repo", "hooks/pre-commit")).resolves.toBe(
      "/repo/.git/hooks/pre-commit",
    );
    await expect(
      git.createBranch("/repo", "fix/helpers", "main"),
    ).resolves.toBeUndefined();
    await expect(git.checkoutBranch("/repo", "main")).resolves.toBeUndefined();
    await expect(git.stageAll("/repo")).resolves.toBeUndefined();
    await expect(git.getStagedDiff("/repo")).resolves.toBe("staged stat");
    await expect(git.getBranchDiff("/repo", "main")).resolves.toBe(
      "branch stat",
    );
    await expect(
      git.commit("/repo", "refactor: share git helpers"),
    ).resolves.toBeUndefined();
    await expect(
      git.push("/repo", "upstream", "fix/helpers"),
    ).resolves.toBeUndefined();

    expect(shell.calls).toEqual([
      {
        args: ["git", "rev-parse", "--show-toplevel"],
        cwd: "/repo",
      },
      {
        args: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd: "/repo",
      },
      {
        args: ["git", "rev-parse", "--git-path", "hooks/pre-commit"],
        cwd: "/repo",
      },
      {
        args: ["git", "checkout", "-b", "fix/helpers", "main"],
        cwd: "/repo",
      },
      {
        args: ["git", "checkout", "main"],
        cwd: "/repo",
      },
      {
        args: ["git", "add", "--all", "--", "."],
        cwd: "/repo",
      },
      {
        args: ["git", "reset", "--", ".agc"],
        cwd: "/repo",
      },
      {
        args: ["git", "diff", "--cached", "--stat"],
        cwd: "/repo",
      },
      {
        args: ["git", "diff", "main...HEAD", "--stat"],
        cwd: "/repo",
      },
      {
        args: ["git", "commit", "-m", "refactor: share git helpers"],
        cwd: "/repo",
      },
      {
        args: ["git", "push", "-u", "upstream", "fix/helpers"],
        cwd: "/repo",
      },
    ]);
  });
});
