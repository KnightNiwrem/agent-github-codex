import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandExecutionError } from "./errors";
import { BunShellRunner } from "./shell";

describe("BunShellRunner", () => {
  test("captures stdout and stderr", async () => {
    const shell = new BunShellRunner();

    const result = await shell.run({
      args: ["bun", "-e", "console.log('out'); console.error('err');"],
    });

    expect(result).toEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 0,
    });
  });

  test("forwards cwd, env, and stdin", async () => {
    const shell = new BunShellRunner();
    const cwd = await mkdtemp(join(tmpdir(), "agc-shell-test-"));

    try {
      const result = await shell.run({
        args: [
          "bun",
          "-e",
          [
            "const input = await new Response(Bun.stdin.stream()).text();",
            "console.log(JSON.stringify({ cwd: process.cwd(), foo: process.env.FOO ?? null, input }));",
          ].join(" "),
        ],
        cwd,
        env: {
          FOO: "bar",
        },
        input: "hello from stdin",
      });

      expect(JSON.parse(result.stdout)).toEqual({
        cwd,
        foo: "bar",
        input: "hello from stdin",
      });
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("throws on non-zero exit without allowFailure", async () => {
    const shell = new BunShellRunner();

    await expect(
      shell.run({
        args: ["bun", "-e", "console.error('boom'); process.exit(7);"],
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        command: ["bun", "-e", "console.error('boom'); process.exit(7);"],
        result: {
          stdout: "",
          stderr: "boom\n",
          exitCode: 7,
        },
      }),
    );
  });

  test("returns non-zero exit results when allowFailure is enabled", async () => {
    const shell = new BunShellRunner();

    const result = await shell.run({
      args: ["bun", "-e", "console.error('boom'); process.exit(7);"],
      allowFailure: true,
    });

    expect(result).toEqual({
      stdout: "",
      stderr: "boom\n",
      exitCode: 7,
    });
  });
});
