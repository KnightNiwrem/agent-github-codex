import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors";
import type { CommandSpec, ShellRunner } from "./types";

const HARNESS_GIT_PATHS = [".agc"];

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

export class GitClient {
  constructor(private readonly shell: ShellRunner) {}

  private async runGit(
    cwd: string,
    args: string[],
    options?: Omit<CommandSpec, "args" | "cwd">,
  ): ReturnType<ShellRunner["run"]> {
    return this.shell.run({
      ...options,
      args: ["git", ...args],
      cwd,
    });
  }

  private getWorkspaceStatusArgs(): string[] {
    return withExcludedPaths(["status", "--porcelain"], HARNESS_GIT_PATHS);
  }

  private async getWorkspaceStatus(cwd: string): Promise<string> {
    const result = await this.runGit(cwd, this.getWorkspaceStatusArgs());

    return result.stdout.trim();
  }

  async getRepositoryRoot(cwd: string): Promise<string> {
    const result = await this.runGit(cwd, ["rev-parse", "--show-toplevel"]);

    return result.stdout.trim();
  }

  async getCurrentBranch(cwd: string): Promise<string> {
    const result = await this.runGit(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);

    return result.stdout.trim();
  }

  async getGitPath(cwd: string, path: string): Promise<string> {
    const result = await this.runGit(cwd, ["rev-parse", "--git-path", path]);

    const resolvedPath = result.stdout.trim();

    return isAbsolute(resolvedPath) ? resolvedPath : resolve(cwd, resolvedPath);
  }

  async ensureCleanWorkspace(cwd: string): Promise<void> {
    if ((await this.getWorkspaceStatus(cwd)).length > 0) {
      throw new AppError("Workspace must be clean before running this CLI.");
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

  async hasChanges(cwd: string): Promise<boolean> {
    return (await this.getWorkspaceStatus(cwd)).length > 0;
  }

  async stageAll(cwd: string): Promise<void> {
    await this.runGit(
      cwd,
      withExcludedPaths(["add", "--all"], HARNESS_GIT_PATHS),
    );
  }

  async getStagedDiff(cwd: string): Promise<string> {
    const result = await this.runGit(cwd, ["diff", "--cached", "--stat"]);

    return result.stdout.trim();
  }

  async getBranchDiff(cwd: string, baseBranch: string): Promise<string> {
    const result = await this.runGit(cwd, [
      "diff",
      `${baseBranch}...HEAD`,
      "--stat",
    ]);

    return result.stdout.trim();
  }

  async commit(cwd: string, message: string): Promise<void> {
    await this.runGit(cwd, ["commit", "-m", message]);
  }

  async push(cwd: string, branch: string): Promise<void> {
    await this.runGit(cwd, ["push", "-u", "origin", branch]);
  }
}
