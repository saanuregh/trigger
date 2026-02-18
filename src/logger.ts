type LogData = Record<string, unknown>;
type WriteFn = (line: string) => void;

export interface Logger {
  level: string;
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
    info: (...args: [LogData, string] | [string]) => emit("info", args),
    warn: (...args: [LogData, string] | [string]) => emit("warn", args),
    error: (...args: [LogData, string] | [string]) => emit("error", args),
    child: (extra) => createLogger({ ...bindings, ...extra }, write),
  };

  function emit(level: string, args: [LogData, string] | [string]) {
    if (self.level === "silent") return;
    const [data, msg] = args.length === 2 ? args : [{}, args[0]];
    write(JSON.stringify({ level, time: new Date().toISOString(), ...bindings, ...data, msg }));
  }

  return self;
}

export const logger = createLogger();
