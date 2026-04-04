import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { HarnessConfig } from "./types";
import { formatZodError } from "./zod-utils";

interface HarnessFileSystem {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
}

interface HarnessDependencies extends HarnessFileSystem {
  resolveDefaultConfig?: () => Promise<HarnessConfig>;
}

export interface HarnessLayout {
  rootDir: string;
  stateDir: string;
  configFile: string;
}

export interface HarnessWorkspaceState extends HarnessLayout {
  config: HarnessConfig;
}

const DEFAULT_PULL_REQUEST_REVIEWERS = ["@copilot"];
const DEFAULT_TRUSTED_REVIEW_COMMENTERS = [
  "@copilot",
  "@coderabbitai[bot]",
  "@cubic-dev-ai[bot]",
  "@gemini-code-assist[bot]",
];

const harnessConfigSchema = z.object({
  pullRequestReviewers: z.array(z.string().trim().min(1)).min(1),
  trustedReviewCommenters: z.array(z.string().trim().min(1)).min(1),
});

export function buildDefaultHarnessConfig(
  currentUserLogin: string,
): HarnessConfig {
  const normalizedCurrentUserLogin = currentUserLogin.trim().replace(/^@+/, "");

  if (normalizedCurrentUserLogin.length === 0) {
    throw new Error("Failed to resolve authenticated GitHub user login.");
  }

  return {
    pullRequestReviewers: [...DEFAULT_PULL_REQUEST_REVIEWERS],
    trustedReviewCommenters: [
      ...new Set([
        ...DEFAULT_TRUSTED_REVIEW_COMMENTERS,
        `@${normalizedCurrentUserLogin}`,
      ]),
    ],
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
  resolveDefaultConfig: () => Promise<HarnessConfig>,
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
    const defaultConfig = normalizeConfig(await resolveDefaultConfig());
    await fileSystem.writeFile(
      path,
      `${JSON.stringify(defaultConfig, null, 2)}\n`,
      "utf8",
    );
    return defaultConfig;
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
  private readonly dependencies: HarnessDependencies;

  constructor(dependencies: Partial<HarnessDependencies> = {}) {
    this.dependencies = {
      mkdir: dependencies.mkdir ?? mkdir,
      readFile: dependencies.readFile ?? readFile,
      writeFile: dependencies.writeFile ?? writeFile,
      resolveDefaultConfig: dependencies.resolveDefaultConfig,
    };
  }

  async ensure(repoRoot: string): Promise<HarnessWorkspaceState> {
    const layout = defaultLayout(repoRoot);

    await this.dependencies.mkdir(layout.stateDir, { recursive: true });
    const config = await ensureConfigFile(
      layout.configFile,
      this.dependencies,
      this.dependencies.resolveDefaultConfig ??
        (async () => buildDefaultHarnessConfig("copilot")),
    );

    return {
      ...layout,
      config,
    };
  }
}
