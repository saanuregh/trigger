import type { JSONValue, LogLevel } from "./types.ts";

type LogData = Record<string, JSONValue | undefined>;
type WriteFn = (line: string) => void;

export type LoggerLevel = LogLevel | "debug" | "silent";

const levelOrder: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export interface Logger {
  level: LoggerLevel;
  debug(data: LogData, msg: string): void;
  debug(msg: string): void;
  info(data: LogData, msg: string): void;
  info(msg: string): void;
  warn(data: LogData, msg: string): void;
  warn(msg: string): void;
  error(data: LogData, msg: string): void;
  error(msg: string): void;
  child(bindings: LogData): Logger;
}

const stdout: WriteFn = (line) => Bun.write(Bun.stdout, `${line}\n`);

export function createLogger(bindings: LogData = {}, write: WriteFn = stdout): Logger {
  const self: Logger = {
    level: "info",
    debug: (...args: [LogData, string] | [string]) => emit("debug", args),
    info: (...args: [LogData, string] | [string]) => emit("info", args),
    warn: (...args: [LogData, string] | [string]) => emit("warn", args),
    error: (...args: [LogData, string] | [string]) => emit("error", args),
    child: (extra) => createLogger({ ...bindings, ...extra }, write),
  };

  function emit(level: LogLevel | "debug", args: [LogData, string] | [string]) {
    if ((levelOrder[level] ?? 0) < (levelOrder[self.level] ?? 0)) return;
    const [data, msg] = args.length === 2 ? args : [{}, args[0]];
    write(JSON.stringify({ level, time: new Date().toISOString(), ...bindings, ...data, msg }));
  }

  return self;
}

export const logger = createLogger();
