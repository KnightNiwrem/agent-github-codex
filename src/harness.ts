import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { HarnessConfig } from "./types";
import { formatZodError } from "./utils";

interface HarnessFileSystem {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
}

export interface HarnessLayout {
  rootDir: string;
  stateDir: string;
  configFile: string;
}

export interface HarnessWorkspaceState extends HarnessLayout {
  config: HarnessConfig;
}

const DEFAULT_CONFIG: HarnessConfig = {
  pullRequestReviewers: ["@copilot"],
  trustedReviewCommenters: ["@copilot"],
};

const harnessConfigSchema = z.object({
  pullRequestReviewers: z.array(z.string().trim().min(1)).min(1),
  trustedReviewCommenters: z.array(z.string().trim().min(1)).min(1),
});

function cloneDefaultConfig(): HarnessConfig {
  return {
    pullRequestReviewers: [...DEFAULT_CONFIG.pullRequestReviewers],
    trustedReviewCommenters: [...DEFAULT_CONFIG.trustedReviewCommenters],
  };
}

function defaultLayout(repoRoot: string): HarnessLayout {
  return {
    rootDir: join(repoRoot, ".agc"),
    stateDir: join(repoRoot, ".agc", "state"),
    configFile: join(repoRoot, ".agc", "config.json"),
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function normalizeConfig(value: unknown): HarnessConfig {
  const parsed = harnessConfigSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(
      `Invalid .agc/config.json: ${formatZodError(parsed.error)}`,
    );
  }

  return {
    pullRequestReviewers: [...new Set(parsed.data.pullRequestReviewers)],
    trustedReviewCommenters: [...new Set(parsed.data.trustedReviewCommenters)],
  };
}

async function ensureConfigFile(
  path: string,
  fileSystem: Pick<HarnessFileSystem, "readFile" | "writeFile">,
): Promise<HarnessConfig> {
  let existing: string | null;

  try {
    existing = await fileSystem.readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    existing = null;
  }

  if (existing === null) {
    await fileSystem.writeFile(
      path,
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
      "utf8",
    );
    return cloneDefaultConfig();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new Error("Invalid .agc/config.json: file must contain valid JSON.");
  }

  return normalizeConfig(parsed);
}

export async function createHarnessTempDirectory(
  stateDir: string,
): Promise<string> {
  await mkdir(stateDir, { recursive: true });
  return await mkdtemp(join(stateDir, "codex-"));
}

export class FileSystemHarnessWorkspace {
  constructor(
    private readonly fileSystem: HarnessFileSystem = {
      mkdir,
      readFile,
      writeFile,
    },
  ) {}

  async ensure(repoRoot: string): Promise<HarnessWorkspaceState> {
    const layout = defaultLayout(repoRoot);

    await this.fileSystem.mkdir(layout.stateDir, { recursive: true });
    const config = await ensureConfigFile(layout.configFile, this.fileSystem);

    return {
      ...layout,
      config,
    };
  }
}
