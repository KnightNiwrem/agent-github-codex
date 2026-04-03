import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "./errors";
import type { HarnessConfig } from "./types";

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
};

const harnessConfigSchema = z.object({
  pullRequestReviewers: z.array(z.string().trim().min(1)).min(1),
});

function cloneDefaultConfig(): HarnessConfig {
  return {
    pullRequestReviewers: [...DEFAULT_CONFIG.pullRequestReviewers],
  };
}

function defaultLayout(repoRoot: string): HarnessLayout {
  return {
    rootDir: join(repoRoot, ".agc"),
    stateDir: join(repoRoot, ".agc", "state"),
    configFile: join(repoRoot, ".agc", "config.json"),
  };
}

function normalizeConfig(value: unknown): HarnessConfig {
  const parsed = harnessConfigSchema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      `Invalid .agc/config.json: ${z.prettifyError(parsed.error)}`,
    );
  }

  return {
    pullRequestReviewers: [...new Set(parsed.data.pullRequestReviewers)],
  };
}

async function ensureConfigFile(path: string): Promise<HarnessConfig> {
  const existing = await readFile(path, "utf8").catch(() => null);

  if (existing === null) {
    await writeFile(
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
    throw new AppError(
      "Invalid .agc/config.json: file must contain valid JSON.",
    );
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
  async ensure(repoRoot: string): Promise<HarnessWorkspaceState> {
    const layout = defaultLayout(repoRoot);

    await mkdir(layout.stateDir, { recursive: true });
    const config = await ensureConfigFile(layout.configFile);

    return {
      ...layout,
      config,
    };
  }
}
