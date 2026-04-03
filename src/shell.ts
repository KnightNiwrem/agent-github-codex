import { AppError, CommandExecutionError } from "./errors";
import type { CommandResult, CommandSpec, ShellRunner } from "./types";

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}

export class BunShellRunner implements ShellRunner {
  async run(spec: CommandSpec): Promise<CommandResult> {
    let processHandle: Bun.Subprocess<"pipe", "pipe", "pipe">;

    try {
      // Keep process execution argv-based and per-call. Bun.$ would add a
      // shell-language layer plus global mutable defaults we do not need here.
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
      throw new AppError(
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

    if (exitCode !== 0 && !spec.allowFailure) {
      throw new CommandExecutionError(spec.args, result);
    }

    return result;
  }
}
