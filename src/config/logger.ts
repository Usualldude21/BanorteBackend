import { env } from "./env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const MAX_LOG_DEPTH = 6;
const MAX_LOG_ARRAY_ITEMS = 20;
const MAX_LOG_OBJECT_KEYS = 50;
const MAX_LOG_STRING_LENGTH = 500;
const SECRET_KEY_PATTERN = /password|token|secret|authorization|cookie|api[_-]?key/i;
const PRIVATE_DATA_KEYS = new Set([
  "account",
  "accounts",
  "amount",
  "balance",
  "data",
  "email",
  "input",
  "output",
  "prompt",
  "query",
  "response",
  "result",
  "rows",
  "sessionid",
  "summary",
  "transaction",
  "transactions",
  "userid",
  "value",
  "values",
]);

export interface StructuredLogger {
  debug(message: string, metadata?: unknown): void;
  info(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
}

interface LoggerOptions {
  level: LogLevel;
  write: (line: string) => void;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  const now = options.now ?? (() => new Date());

  function log(level: LogLevel, message: string, metadata?: unknown): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[options.level]) return;
    const entry = {
      timestamp: now().toISOString(),
      level,
      message,
      ...(metadata === undefined ? {} : { metadata: sanitizeLogValue(metadata) }),
    };
    options.write(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug: (message, metadata) => log("debug", message, metadata),
    info: (message, metadata) => log("info", message, metadata),
    warn: (message, metadata) => log("warn", message, metadata),
    error: (message, metadata) => log("error", message, metadata),
  };
}

export const logger = createLogger({
  level: env.LOG_LEVEL,
  write: (line) => process.stderr.write(line),
});

function sanitizeLogValue(value: unknown): unknown {
  return sanitize(value, 0, new WeakSet<object>());
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= MAX_LOG_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_LOG_STRING_LENGTH)}[truncated]`;
  }
  if (typeof value !== "object") return String(value);
  if (value instanceof Error) return { errorType: value.name };
  if (depth >= MAX_LOG_DEPTH) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => sanitize(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_LOG_OBJECT_KEYS)) {
    sanitized[key] = isPrivateKey(key)
      ? "[redacted]"
      : sanitize(nestedValue, depth + 1, seen);
  }
  return sanitized;
}

function isPrivateKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return SECRET_KEY_PATTERN.test(key) || PRIVATE_DATA_KEYS.has(normalized);
}
