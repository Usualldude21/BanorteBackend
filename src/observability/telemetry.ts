import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logger, type StructuredLogger } from "../config/logger.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTOR_ID_PATTERN = /^(?:anonymous|[a-f0-9]{16})$/;
const SPAN_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const ANONYMOUS_ACTOR = "anonymous";

export interface TraceContext {
  requestId: string;
  actorId: string;
}

export interface SpanAttributes {
  component: "agent" | "llm" | "mcp" | "supabase" | "ui";
  operation: string;
  toolName?: string;
  queryName?: string;
}

export interface SpanSummary {
  toolCallCount?: number;
  resultCount?: number;
  outputBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  thinkingTokens?: number;
}

interface TelemetryOptions {
  sink?: StructuredLogger;
  now?: () => number;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export class Telemetry {
  private readonly sink: StructuredLogger;
  private readonly now: () => number;

  constructor(options: TelemetryOptions = {}) {
    this.sink = options.sink ?? logger;
    this.now = options.now ?? performance.now.bind(performance);
  }

  startSpan(attributes: SpanAttributes, context = currentTraceContext()): TelemetrySpan {
    validateTraceContext(context);
    validateSpanAttributes(attributes);
    const startedAt = this.now();
    this.sink.info("Observability span started", {
      event: "span.started",
      ...context,
      ...attributes,
    });
    return new TelemetrySpan(this.sink, this.now, startedAt, context, attributes);
  }

  async observe<T>(
    attributes: SpanAttributes,
    operation: () => Promise<T>,
    summarize?: (value: T) => SpanSummary,
  ): Promise<T> {
    const span = this.startSpan(attributes);
    try {
      const value = await operation();
      span.complete(summarize?.(value));
      return value;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  }
}

export class TelemetrySpan {
  private hasEnded = false;

  constructor(
    private readonly sink: StructuredLogger,
    private readonly now: () => number,
    private readonly startedAt: number,
    private readonly context: TraceContext,
    private readonly attributes: SpanAttributes,
  ) {}

  complete(summary: SpanSummary = {}): void {
    this.end(true, summary);
  }

  fail(error: unknown, summary: SpanSummary = {}): void {
    this.end(false, summary, errorType(error));
  }

  private end(success: boolean, summary: SpanSummary, failureType?: string): void {
    if (this.hasEnded) return;
    this.hasEnded = true;
    this.sink.info("Observability span completed", {
      event: "span.completed",
      ...this.context,
      ...this.attributes,
      durationMs: roundDuration(this.now() - this.startedAt),
      success,
      ...(failureType ? { errorType: failureType } : {}),
      ...summary,
    });
  }
}

const silentSink: StructuredLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const telemetry = process.env.NODE_ENV === "test"
  ? new Telemetry({ sink: silentSink })
  : new Telemetry();

export function createTraceContext(requestId: string, userId?: string): TraceContext {
  const context = {
    requestId,
    actorId: userId ? anonymizeActorId(userId) : ANONYMOUS_ACTOR,
  };
  validateTraceContext(context);
  return context;
}

export function createStandaloneTraceContext(userId?: string): TraceContext {
  return createTraceContext(randomUUID(), userId);
}

export function runWithTraceContext<T>(context: TraceContext, operation: () => T): T {
  return traceStorage.run(context, operation);
}

export function currentTraceContext(): TraceContext {
  return traceStorage.getStore() ?? createStandaloneTraceContext();
}

export function anonymizeActorId(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 16);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function roundDuration(durationMs: number): number {
  return Math.max(0, Math.round(durationMs * 100) / 100);
}

function validateTraceContext(context: TraceContext): void {
  if (
    !REQUEST_ID_PATTERN.test(context.requestId)
    || !ACTOR_ID_PATTERN.test(context.actorId)
  ) {
    throw new InvalidTraceContextError();
  }
}

function validateSpanAttributes(attributes: SpanAttributes): void {
  const labels = [attributes.operation, attributes.toolName, attributes.queryName]
    .filter((label): label is string => label !== undefined);
  if (labels.some((label) => !SPAN_LABEL_PATTERN.test(label))) {
    throw new InvalidSpanAttributesError();
  }
}

export class InvalidTraceContextError extends Error {
  constructor() {
    super("El identificador de traza no es válido");
    this.name = "InvalidTraceContextError";
  }
}

export class InvalidSpanAttributesError extends Error {
  constructor() {
    super("Los atributos del span no son válidos");
    this.name = "InvalidSpanAttributesError";
  }
}
