import type { CommandResult, CommandSpec, ShellRunner } from "./types";

export class StubShellRunner implements ShellRunner {
  readonly calls: CommandSpec[] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    const result = this.results.shift();

    if (!result) {
      throw new Error(`Unexpected command: ${spec.args.join(" ")}`);
    }

    return result;
  }
}

export function result(stdout = "", stderr = "", exitCode = 0): CommandResult {
  return {
    stdout,
    stderr,
    exitCode,
  };
}
