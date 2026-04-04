import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPackageVersion } from "../src/version";

describe("CLI versioning", () => {
  it("prints the package version with --version", async () => {
    const packageJsonFile = new URL("../package.json", import.meta.url);
    const testFilePath = fileURLToPath(import.meta.url);
    const cwd = resolve(dirname(testFilePath), "..");
    const packageJson = JSON.parse(await Bun.file(packageJsonFile).text()) as {
      version: string;
    };
    const child = Bun.spawn(
      [process.execPath, "run", "src/index.ts", "--version"],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${packageJson.version}\n`);
    expect(stderr).toBe("");
  });

  it("throws a clear error when package.json is invalid JSON", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agc-version-"));
    const invalidPackageJsonFile = pathToFileURL(join(tempDir, "package.json"));

    await writeFile(invalidPackageJsonFile, "{ invalid json\n", "utf8");

    try {
      await expect(readPackageVersion(invalidPackageJsonFile)).rejects.toThrow(
        "Invalid package.json: must contain valid JSON.",
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
