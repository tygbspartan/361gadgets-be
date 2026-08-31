import pino from "pino";
import pretty from "pino-pretty";

const isProduction = process.env.NODE_ENV === "production";

const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  base: undefined, // drop default pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    // Never let secrets/PII leak into logs.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "token",
    ],
    remove: true,
  },
};

// Single structured logger for the whole app.
// - Production: JSON lines, so a log aggregator can parse them.
// - Development: pretty-printed, colorized, single-line output for readability.
//   Uses pino-pretty as a direct destination stream (not a transport worker),
//   which prints reliably under ts-node/nodemon.
export const logger = isProduction
  ? pino(options)
  : pino(
      options,
      pretty({
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
        singleLine: true,
      }),
    );
