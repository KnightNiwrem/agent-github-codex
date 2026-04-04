import { describe, expect, it } from "bun:test";
import { CLI_VERSION, createProgram } from "../src/index";

async function buildVersionOutput(argv: string[]): Promise<{
  error?: Error;
  stderr: string;
  stdout: string;
}> {
  let stdout = "";
  let stderr = "";
  const program = createProgram();

  program.exitOverride();
  program.configureOutput({
    writeErr: (message) => {
      stderr += message;
    },
    writeOut: (message) => {
      stdout += message;
    },
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return { stderr, stdout };
  } catch (error) {
    return { error: error as Error, stderr, stdout };
  }
}

describe("cli versioning", () => {
  it("prints the package version with --version", async () => {
    const result = await buildVersionOutput(["--version"]);

    expect(result.error).toBeDefined();
    expect(result.stdout).toBe(`${CLI_VERSION}\n`);
    expect(result.stderr).toBe("");
  });

  it("prints the package version with -V", async () => {
    const result = await buildVersionOutput(["-V"]);

    expect(result.error).toBeDefined();
    expect(result.stdout).toBe(`${CLI_VERSION}\n`);
    expect(result.stderr).toBe("");
  });
});
