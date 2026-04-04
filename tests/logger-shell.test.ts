import { describe, expect, it } from "bun:test";
import { ConsoleLogger } from "../src/logger";
import { BunShellRunner } from "../src/shell";
import type { JsonObject, Logger } from "../src/types";

describe("ConsoleLogger", () => {
  it("emits structured JSON lines with severity, type, and data", () => {
    const originalLog = console.log;
    const calls: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const logger = new ConsoleLogger();
      logger.info("command.complete", {
        command: ["gh", "api", "user"],
        exitCode: 0,
        stdout: '{"login":"KnightNiwrem"}',
      });
    } finally {
      console.log = originalLog;
    }

    expect(calls).toHaveLength(1);
    const serialized = calls.at(0)?.[0];
    const payload =
      typeof serialized === "string" ? JSON.parse(serialized) : undefined;

    expect(payload).toMatchObject({
      severity: "info",
      type: "command",
      event: "command.complete",
      data: {
        command: ["gh", "api", "user"],
        exitCode: 0,
        stdout: '{"login":"KnightNiwrem"}',
      },
    });
    expect(payload.timestamp).toEqual(expect.any(String));
  });
});

describe("BunShellRunner", () => {
  it("logs command execution and results", async () => {
    const entries: Array<{
      level: string;
      event: string;
      fields?: JsonObject;
    }> = [];
    const logger: Logger = {
      info(event: string, fields?: JsonObject) {
        entries.push({ level: "info", event, fields });
      },
      warn(event: string, fields?: JsonObject) {
        entries.push({ level: "warn", event, fields });
      },
      error(event: string, fields?: JsonObject) {
        entries.push({ level: "error", event, fields });
      },
    };
    const shell = new BunShellRunner(logger);

    const result = await shell.run({
      args: ["bun", "--print", "process.stderr.write('warn'); 'hello'"],
      cwd: "/tmp",
      allowFailure: true,
    });

    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "warn",
      exitCode: 0,
    });
    expect(entries).toEqual([
      {
        level: "info",
        event: "command.start",
        fields: {
          command: ["bun", "--print", "process.stderr.write('warn'); 'hello'"],
          cwd: "/tmp",
          allowFailure: true,
          input: undefined,
        },
      },
      {
        level: "info",
        event: "command.complete",
        fields: {
          command: ["bun", "--print", "process.stderr.write('warn'); 'hello'"],
          cwd: "/tmp",
          allowFailure: true,
          exitCode: 0,
          stdout: "hello\n",
          stderr: "warn",
        },
      },
    ]);
  });
});
