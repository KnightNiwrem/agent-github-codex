import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
});
