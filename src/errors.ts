import type { CommandResult } from "./types";

export class CommandExecutionError extends Error {
  readonly command: string[];
  readonly result: CommandResult;

  constructor(command: string[], result: CommandResult) {
    super(
      `Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr || result.stdout}`,
    );
    this.name = "CommandExecutionError";
    this.command = command;
    this.result = result;
  }
}
