import pino from "pino";

const isoTimestamp = () => `,"time":"${new Date().toISOString()}"`;
const levelLabel: pino.LoggerOptions["formatters"] = {
  level(label) { return { level: label }; },
};

export const logger = pino({
  base: {},
  timestamp: isoTimestamp,
  formatters: levelLabel,
});

export const stepLoggerOpts: pino.LoggerOptions = {
  base: null,
  timestamp: isoTimestamp,
  formatters: levelLabel,
};

export type Logger = pino.Logger;
