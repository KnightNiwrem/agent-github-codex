import { isAbsolute, resolve } from "node:path";
import type { CommandSpec, ShellRunner } from "./types";

const HARNESS_GIT_PATHS = [".agc"];

export type GitCommandOptions = Omit<CommandSpec, "args" | "cwd">;

function withExcludedPaths(
  baseArgs: string[],
  excludedPaths: string[],
): string[] {
  return [
    ...baseArgs,
    "--",
    ".",
    ...excludedPaths.map((path) => `:(exclude)${path}`),
  ];
}

export function runGitCommand(
  shell: ShellRunner,
  cwd: string,
  args: string[],
  options?: GitCommandOptions,
): ReturnType<ShellRunner["run"]> {
  return shell.run({
    ...options,
    args: ["git", ...args],
    cwd,
  });
}

export async function runGitTextCommand(
  shell: ShellRunner,
  cwd: string,
  args: string[],
  options?: GitCommandOptions,
): Promise<string> {
  const result = await runGitCommand(shell, cwd, args, options);

  return result.stdout.trim();
}

export class GitClient {
  constructor(private readonly shell: ShellRunner) {}

  private async runGit(
    cwd: string,
    args: string[],
    options?: GitCommandOptions,
  ): ReturnType<ShellRunner["run"]> {
    return runGitCommand(this.shell, cwd, args, options);
  }

  private async runGitText(
    cwd: string,
    args: string[],
    options?: GitCommandOptions,
  ): Promise<string> {
    return runGitTextCommand(this.shell, cwd, args, options);
  }

  private getWorkspaceStatusArgs(): string[] {
    return withExcludedPaths(["status", "--porcelain"], HARNESS_GIT_PATHS);
  }

  private async getWorkspaceStatus(cwd: string): Promise<string> {
    return this.runGitText(cwd, this.getWorkspaceStatusArgs());
  }

  async getRepositoryRoot(cwd: string): Promise<string> {
    return this.runGitText(cwd, ["rev-parse", "--show-toplevel"]);
  }

  async getCurrentBranch(cwd: string): Promise<string> {
    return this.runGitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  async getGitPath(cwd: string, path: string): Promise<string> {
    const resolvedPath = await this.runGitText(cwd, [
      "rev-parse",
      "--git-path",
      path,
    ]);

    return isAbsolute(resolvedPath) ? resolvedPath : resolve(cwd, resolvedPath);
  }

  async ensureCleanWorkspace(cwd: string): Promise<void> {
    if ((await this.getWorkspaceStatus(cwd)).length > 0) {
      throw new Error("Workspace must be clean before running this CLI.");
    }
  }

  async createBranch(
    cwd: string,
    branch: string,
    baseBranch: string,
  ): Promise<void> {
    await this.runGit(cwd, ["checkout", "-b", branch, baseBranch]);
  }

  async checkoutBranch(cwd: string, branch: string): Promise<void> {
    await this.runGit(cwd, ["checkout", branch]);
  }

  async deleteBranch(
    cwd: string,
    branch: string,
    options: GitCommandOptions & { force?: boolean } = {},
  ): ReturnType<ShellRunner["run"]> {
    const { force = false, ...gitOptions } = options;

    return this.runGit(
      cwd,
      ["branch", force ? "-D" : "-d", branch],
      gitOptions,
    );
  }

  async hasChanges(cwd: string): Promise<boolean> {
    return (await this.getWorkspaceStatus(cwd)).length > 0;
  }

  async stageAll(cwd: string): Promise<void> {
    await this.runGit(cwd, ["add", "--all", "--", "."]);
    await this.runGit(cwd, ["reset", "--", ...HARNESS_GIT_PATHS]);
  }

  async getStagedDiff(cwd: string): Promise<string> {
    return this.runGitText(cwd, ["diff", "--cached", "--stat"]);
  }

  async getBranchDiff(cwd: string, baseBranch: string): Promise<string> {
    return this.runGitText(cwd, ["diff", `${baseBranch}...HEAD`, "--stat"]);
  }

  async commit(cwd: string, message: string): Promise<void> {
    await this.runGit(cwd, ["commit", "-m", message]);
  }

  async push(cwd: string, remoteName: string, branch: string): Promise<void> {
    await this.runGit(cwd, ["push", "-u", remoteName, branch]);
  }
}
