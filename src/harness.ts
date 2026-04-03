import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AppError } from "./errors";
import type { HarnessConfig } from "./types";

export interface HarnessLayout {
  rootDir: string;
  stateDir: string;
  configFile: string;
  gitExcludeFile: string;
}

export interface HarnessWorkspaceState extends HarnessLayout {
  config: HarnessConfig;
}

const DEFAULT_CONFIG: HarnessConfig = {
  pullRequestReviewers: ["@copilot"],
};

const AGC_EXCLUDE_ENTRY = "/.agc/";
const harnessConfigSchema = z.object({
  pullRequestReviewers: z.array(z.string().trim()).min(1),
});

function defaultLayout(repoRoot: string): HarnessLayout {
  return {
    rootDir: join(repoRoot, ".agc"),
    stateDir: join(repoRoot, ".agc", "state"),
    configFile: join(repoRoot, ".agc", "config.json"),
    gitExcludeFile: join(repoRoot, ".git", "info", "exclude"),
  };
}

function normalizeConfig(value: unknown): HarnessConfig {
  const parsed = harnessConfigSchema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      `Invalid .agc/config.json: ${z.prettifyError(parsed.error)}`,
    );
  }

  const normalizedReviewers = parsed.data.pullRequestReviewers.filter(
    (reviewer) => reviewer.length > 0,
  );

  if (normalizedReviewers.length === 0) {
    throw new AppError(
      "Invalid .agc/config.json: pullRequestReviewers must include at least one reviewer.",
    );
  }

  return {
    pullRequestReviewers: [...new Set(normalizedReviewers)],
  };
}

async function ensureGitExcludeEntry(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const current = await readFile(path, "utf8").catch(() => "");
  const entries = current
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.includes(AGC_EXCLUDE_ENTRY)) {
    return;
  }

  const next =
    current.endsWith("\n") || current.length === 0
      ? `${current}${AGC_EXCLUDE_ENTRY}\n`
      : `${current}\n${AGC_EXCLUDE_ENTRY}\n`;

  await writeFile(path, next, "utf8");
}

async function ensureConfigFile(path: string): Promise<HarnessConfig> {
  const existing = await readFile(path, "utf8").catch(() => null);

  if (existing === null) {
    await writeFile(
      path,
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
      "utf8",
    );
    return DEFAULT_CONFIG;
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
    await ensureGitExcludeEntry(layout.gitExcludeFile);
    const config = await ensureConfigFile(layout.configFile);

    return {
      ...layout,
      config,
    };
  }
}
