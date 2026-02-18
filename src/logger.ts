import pino from "pino";

const timestamp = () => `,"time":"${new Date().toISOString()}"`;
const formatters: pino.LoggerOptions["formatters"] = {
  level: (label) => ({ level: label }),
};

export const logger = pino({ base: {}, timestamp, formatters });

export const stepLoggerOpts: pino.LoggerOptions = { base: null, timestamp, formatters };

export type Logger = pino.Logger;
