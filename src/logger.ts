import type { JsonValue, LogFields, Logger } from "./types";

function inferLogType(event: string): string {
  if (event.startsWith("command.")) {
    return "command";
  }

  if (event.startsWith("parse.")) {
    return "parse";
  }

  return "state";
}

function normalizeValue(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item) ?? null);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        normalizeValue(entryValue),
      ]),
    );
  }

  return value;
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
    data: normalizeValue(fields) ?? {},
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
