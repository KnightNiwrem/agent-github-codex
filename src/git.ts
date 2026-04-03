import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors";
import type { ShellRunner } from "./types";

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

  async getRepositoryRoot(cwd: string): Promise<string> {
    const result = await this.shell.run({
      args: ["git", "rev-parse", "--show-toplevel"],
      cwd,
    });

    return result.stdout.trim();
  }

  async getCurrentBranch(cwd: string): Promise<string> {
    const result = await this.shell.run({
      args: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      cwd,
    });

    return result.stdout.trim();
  }

  async getGitPath(cwd: string, path: string): Promise<string> {
    const result = await this.shell.run({
      args: ["git", "rev-parse", "--git-path", path],
      cwd,
    });

    const resolvedPath = result.stdout.trim();

    return isAbsolute(resolvedPath) ? resolvedPath : resolve(cwd, resolvedPath);
  }

  async ensureCleanWorkspace(cwd: string): Promise<void> {
    const result = await this.shell.run({
      args: withExcludedPaths(
        ["git", "status", "--porcelain"],
        HARNESS_GIT_PATHS,
      ),
      cwd,
    });

    if (result.stdout.trim().length > 0) {
      throw new AppError("Workspace must be clean before running this CLI.");
    }
  }

  async createBranch(
    cwd: string,
    branch: string,
    baseBranch: string,
  ): Promise<void> {
    await this.shell.run({
      args: ["git", "checkout", "-b", branch, baseBranch],
      cwd,
    });
  }

  async checkoutBranch(cwd: string, branch: string): Promise<void> {
    await this.shell.run({
      args: ["git", "checkout", branch],
      cwd,
    });
  }

  async hasChanges(cwd: string): Promise<boolean> {
    const result = await this.shell.run({
      args: withExcludedPaths(
        ["git", "status", "--porcelain"],
        HARNESS_GIT_PATHS,
      ),
      cwd,
    });

    return result.stdout.trim().length > 0;
  }

  async stageAll(cwd: string): Promise<void> {
    await this.shell.run({
      args: withExcludedPaths(["git", "add", "--all"], HARNESS_GIT_PATHS),
      cwd,
    });
  }

  async getStagedDiff(cwd: string): Promise<string> {
    const result = await this.shell.run({
      args: ["git", "diff", "--cached", "--stat"],
      cwd,
    });

    return result.stdout.trim();
  }

  async getBranchDiff(cwd: string, baseBranch: string): Promise<string> {
    const result = await this.shell.run({
      args: ["git", "diff", `${baseBranch}...HEAD`, "--stat"],
      cwd,
    });

    return result.stdout.trim();
  }

  async commit(cwd: string, message: string): Promise<void> {
    await this.shell.run({
      args: ["git", "commit", "-m", message],
      cwd,
    });
  }

  async push(cwd: string, branch: string): Promise<void> {
    await this.shell.run({
      args: ["git", "push", "-u", "origin", branch],
      cwd,
    });
  }
}
