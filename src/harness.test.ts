import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "./errors";
import { FileSystemHarnessWorkspace } from "./harness";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agc-harness-test-"));
  temporaryDirectories.push(root);
  return root;
}

test("creates a default .agc layout", async () => {
  const repoRoot = await createRepositoryRoot();
  const workspace = new FileSystemHarnessWorkspace();

  const state = await workspace.ensure(repoRoot);

  expect(state.rootDir).toBe(join(repoRoot, ".agc"));
  expect(state.stateDir).toBe(join(repoRoot, ".agc", "state"));
  expect(state.config.pullRequestReviewers).toEqual(["@copilot"]);
  expect(JSON.parse(await readFile(state.configFile, "utf8"))).toEqual({
    pullRequestReviewers: ["@copilot"],
  });
});

test("reuses existing .agc reviewer configuration", async () => {
  const repoRoot = await createRepositoryRoot();
  const workspace = new FileSystemHarnessWorkspace();
  const configFile = join(repoRoot, ".agc", "config.json");

  await mkdir(join(repoRoot, ".agc"), { recursive: true });
  await Bun.write(
    configFile,
    `${JSON.stringify({ pullRequestReviewers: ["@review-bot", "@copilot"] }, null, 2)}\n`,
  );

  const state = await workspace.ensure(repoRoot);

  expect(state.config.pullRequestReviewers).toEqual([
    "@review-bot",
    "@copilot",
  ]);
});

test("rejects non-string reviewer values in .agc config", async () => {
  const repoRoot = await createRepositoryRoot();
  const workspace = new FileSystemHarnessWorkspace();
  const configFile = join(repoRoot, ".agc", "config.json");

  await mkdir(join(repoRoot, ".agc"), { recursive: true });
  await Bun.write(
    configFile,
    `${JSON.stringify({ pullRequestReviewers: ["@copilot", { login: "@review-bot" }] }, null, 2)}\n`,
  );

  await expect(workspace.ensure(repoRoot)).rejects.toThrow(
    /Invalid \.agc\/config\.json:.*expected string, received object/s,
  );
});

test("rejects blank reviewer values in .agc config", async () => {
  const repoRoot = await createRepositoryRoot();
  const workspace = new FileSystemHarnessWorkspace();
  const configFile = join(repoRoot, ".agc", "config.json");

  await mkdir(join(repoRoot, ".agc"), { recursive: true });
  await Bun.write(
    configFile,
    `${JSON.stringify({ pullRequestReviewers: ["   "] }, null, 2)}\n`,
  );

  await expect(workspace.ensure(repoRoot)).rejects.toThrow(
    /Invalid \.agc\/config\.json:.*Too small: expected string to have >=1 characters/s,
  );
});
