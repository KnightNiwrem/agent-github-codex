import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors";
import type { ShellRunner } from "./types";

const HARNESS_ROOT = ".agc";

function normalizeStatusPath(path: string): string {
  return path.trim().replace(/^"+|"+$/g, "");
}

function isHarnessPath(path: string): boolean {
  const normalized = normalizeStatusPath(path);
  return (
    normalized === HARNESS_ROOT || normalized.startsWith(`${HARNESS_ROOT}/`)
  );
}

function hasNonHarnessChanges(stdout: string): boolean {
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.length > 0)
    .some((entry) => {
      const paths = entry
        .slice(3)
        .trim()
        .split(" -> ")
        .map((path) => path.trim())
        .filter((path) => path.length > 0);

      return paths.some((path) => !isHarnessPath(path));
    });
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
      args: ["git", "status", "--porcelain"],
      cwd,
    });

    if (hasNonHarnessChanges(result.stdout)) {
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
      args: ["git", "status", "--porcelain"],
      cwd,
    });

    return hasNonHarnessChanges(result.stdout);
  }

  async stageAll(cwd: string): Promise<void> {
    await this.shell.run({
      args: ["git", "add", "--all"],
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
