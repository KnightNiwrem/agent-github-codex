import { describe, expect, it } from "bun:test";

describe("CLI versioning", () => {
  it("prints the package version with --version", async () => {
    const packageJsonFile = new URL("../package.json", import.meta.url);
    const packageJson = JSON.parse(await Bun.file(packageJsonFile).text()) as {
      version: string;
    };
    const child = Bun.spawn(
      [process.execPath, "run", "src/index.ts", "--version"],
      {
        cwd: new URL("..", import.meta.url).pathname,
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
