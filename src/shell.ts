import { CommandExecutionError } from "./errors";
import type { CommandResult, CommandSpec, Logger, ShellRunner } from "./types";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

export class BunShellRunner implements ShellRunner {
  constructor(private readonly logger?: Logger) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    let processHandle: Bun.Subprocess<"pipe", "pipe", "pipe">;
    this.logger?.info("command.start", {
      command: spec.args,
      cwd: spec.cwd ?? process.cwd(),
      allowFailure: spec.allowFailure ?? false,
      input: spec.input,
    });

    try {
      processHandle = Bun.spawn({
        cmd: spec.args,
        cwd: spec.cwd,
        env: {
          ...process.env,
          ...spec.env,
        },
        stdin: spec.input ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error("command.spawn_failed", {
        command: spec.args,
        cwd: spec.cwd ?? process.cwd(),
        allowFailure: spec.allowFailure ?? false,
        input: spec.input,
        error: message,
      });
      throw new Error(
        `Failed to start command: ${spec.args.join(" ")}\n${message}`,
      );
    }

    if (spec.input) {
      await processHandle.stdin.write(spec.input);
      await processHandle.stdin.end();
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(processHandle.stdout),
      readStream(processHandle.stderr),
      processHandle.exited,
    ]);

    const result: CommandResult = {
      stdout,
      stderr,
      exitCode,
    };

    this.logger?.info("command.complete", {
      command: spec.args,
      cwd: spec.cwd ?? process.cwd(),
      allowFailure: spec.allowFailure ?? false,
      exitCode,
      stdout,
      stderr,
    });

    if (exitCode !== 0 && !spec.allowFailure) {
      this.logger?.error("command.failed", {
        command: spec.args,
        cwd: spec.cwd ?? process.cwd(),
        exitCode,
        stdout,
        stderr,
      });
      throw new CommandExecutionError(spec.args, result);
    }

    return result;
  }
}
