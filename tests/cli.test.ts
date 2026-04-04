import { expect, it } from "bun:test";
import packageJson from "../package.json" with { type: "json" };

async function runCli(args: string[]) {
  const process = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts", ...args],
    cwd: `${import.meta.dir}/..`,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

it("prints the package version with --version", async () => {
  const result = await runCli(["--version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${packageJson.version}\n`);
  expect(result.stderr).toBe("");
});

it("prints the package version with -V", async () => {
  const result = await runCli(["-V"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${packageJson.version}\n`);
  expect(result.stderr).toBe("");
});
