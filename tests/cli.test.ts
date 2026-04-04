import { expect, it } from "bun:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");

it("prints the package version with --version", async () => {
  const childProcess = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts", "--version"],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
    childProcess.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(packageJson.version);
});
