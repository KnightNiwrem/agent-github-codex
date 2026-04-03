import type { LogFields, Logger } from "./types";

function emit(
  level: "info" | "warn" | "error",
  event: string,
  fields?: LogFields,
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
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
