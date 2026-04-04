import type { LogFields, LogType, Logger } from "./types";

function inferLogType(event: string): LogType {
  if (event.startsWith("command.")) {
    return "command";
  }

  if (event.startsWith("parse.")) {
    return "parse";
  }

  return "state";
}

function emit(
  level: "info" | "warn" | "error",
  event: string,
  fields?: LogFields,
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    severity: level,
    type: inferLogType(event),
    event,
    data: fields ?? {},
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

export class ConsoleLogger implements Logger {
  info(event: string, fields?: LogFields): void {
    emit("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    emit("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    emit("error", event, fields);
  }
}
