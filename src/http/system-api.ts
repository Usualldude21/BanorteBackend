import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  errorPayloadSchema,
  financialSummaryRequestSchema,
  textAgentRequestSchema,
  textAgentStreamEventSchema,
  type FinancialSummaryResponse,
} from "@banorte/contracts";
import {
  createFinancialSummaryService,
  type FinancialSummaryService,
} from "../integration/financial-summary-service.js";
import { createTextAgentService, type TextAgentService } from "../integration/text-agent-service.js";
import { createSystemStatus, type RuntimeCapabilities } from "./system-status.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  createSupabaseSessionWithAccessToken,
  type AuthenticatedSupabaseSession,
} from "../config/supabase.js";
import { type SessionFactory } from "../agent/cli/agent-runtime.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import { applyHttpSecurity, setSecurityHeaders } from "./http-security.js";
import { readSessionUiSnapshot } from "../integration/session-ui-snapshot.js";
import { z } from "zod";

const STATUS_PATH = "/api/system/status";
const FINANCIAL_SUMMARY_PATH = "/api/integration/financial-summary";
const AGENT_PATH = "/api/agent";
const SNAPSHOT_PATH = "/api/agent/snapshot";
const MAX_REQUEST_BYTES = 16_384;

export interface SystemApiOptions {
  readCapabilities?: () => RuntimeCapabilities;
  now?: () => Date;
  financialSummary?: FinancialSummaryService;
  textAgent?: TextAgentService;
  apiToken?: string;
  createUserSession?: (accessToken: string) => Promise<AuthenticatedSupabaseSession>;
  authenticationRateLimiter?: ToolRateLimiter;
  requestRateLimiter?: ToolRateLimiter;
  allowedOrigins?: readonly string[];
}

export function createSystemApi(options: SystemApiOptions = {}) {
  const financialSummary = options.financialSummary ?? createFinancialSummaryService();
  const textAgent = options.textAgent ?? createTextAgentService();
  const authenticationRateLimiter = options.authenticationRateLimiter ?? new ToolRateLimiter({
    maxCalls: env.AGENT_AUTH_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  });
  const requestRateLimiter = options.requestRateLimiter ?? new ToolRateLimiter({
    maxCalls: env.AGENT_API_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  });
  return createServer((request, response) => {
    void handleRequest(
      request,
      response,
      options,
      financialSummary,
      textAgent,
      authenticationRateLimiter,
      requestRateLimiter,
    ).catch(() => {
      if (!response.headersSent) setSecurityHeaders(response);
      if (!response.writableEnded) writeError(response, 500, "internal_error", "No fue posible completar la solicitud", true);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SystemApiOptions,
  financialSummary: FinancialSummaryService,
  textAgent: TextAgentService,
  authenticationRateLimiter: ToolRateLimiter,
  requestRateLimiter: ToolRateLimiter,
): Promise<void> {
  const securityDecision = applyHttpSecurity(
    request,
    response,
    options.allowedOrigins ?? env.AGENT_API_ALLOWED_ORIGINS,
  );
  if (securityDecision.kind === "responded") return;

  let authenticatedSessionFactory: SessionFactory | undefined;
  if (isProtectedRoute(request)) {
    try {
      authenticationRateLimiter
        .forScope(request.socket.remoteAddress ?? "unknown")
        .consume("supabase-authentication");
    } catch (error) {
      if (error instanceof RateLimitError) {
        writeRateLimitExceeded(response, error);
        return;
      }
      throw error;
    }
    authenticatedSessionFactory = await createAuthenticatedRequestSessionFactory(
      request,
      options.apiToken ?? env.AGENT_API_TOKEN,
      options.createUserSession ?? createSupabaseSessionWithAccessToken,
    );
    if (!authenticatedSessionFactory) {
      writeAuthenticationRequired(response);
      return;
    }
    const authenticatedSession = await authenticatedSessionFactory();
    try {
      requestRateLimiter
        .forScope(authenticatedSession.user.id)
        .consume(request.url ?? "unknown");
    } catch (error) {
      if (error instanceof RateLimitError) {
        writeRateLimitExceeded(response, error);
        return;
      }
      throw error;
    }
  }

  if (request.method === "GET" && request.url === STATUS_PATH) {
    const status = createSystemStatus(options.readCapabilities?.(), options.now);
    writeJson(response, 200, status);
    return;
  }

  if (request.method === "POST" && request.url === FINANCIAL_SUMMARY_PATH) {
    await handleFinancialSummary(request, response, financialSummary, authenticatedSessionFactory!);
    return;
  }

  if (request.method === "POST" && request.url === AGENT_PATH) {
    await handleTextAgent(request, response, textAgent, authenticatedSessionFactory!);
    return;
  }

  if (request.method === "POST" && request.url === SNAPSHOT_PATH) {
    let body: unknown;
    try { body = await readJsonBody(request); } catch {
      writeError(response, 400, "invalid_request", "Solicitud inválida", false); return;
    }
    const parsed = z.object({ sessionId: z.string().uuid() }).strict().safeParse(body);
    if (!parsed.success) { writeError(response, 400, "invalid_request", "Solicitud inválida", false); return; }
    const session = await authenticatedSessionFactory!();
    const result = await readSessionUiSnapshot(session.client, parsed.data.sessionId);
    if (result.code !== "success") {
      const status = result.code === "session_busy" ? 409
        : result.code === "snapshot_unavailable" ? 503 : 404;
      writeError(response, status, result.code, "Snapshot autoritativo no disponible", false); return;
    }
    writeJson(response, 200, result.snapshot);
    return;
  }

  writeError(response, 404, "route_not_found", "Ruta no disponible", false);
}

async function handleTextAgent(
  request: IncomingMessage,
  response: ServerResponse,
  service: TextAgentService,
  sessionFactory: SessionFactory,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    writeError(response, 400, "invalid_request", "Solicitud inválida", false);
    return;
  }
  const parsed = textAgentRequestSchema.safeParse(body);
  if (!parsed.success) {
    writeError(response, 400, "invalid_request", "Solicitud inválida", false);
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortOnPrematureClose = () => {
    if (!response.writableEnded) abort();
  };
  request.once("aborted", abort);
  response.once("close", abortOnPrematureClose);
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  const startedAt = performance.now();
  logger.info("Agent API stream iniciado", { correlationId: parsed.data.correlationId });

  try {
    for await (const event of service(parsed.data, controller.signal, sessionFactory)) {
      response.write(`${JSON.stringify(textAgentStreamEventSchema.parse(event))}\n`);
    }
  } catch {
    if (!response.writableEnded && !controller.signal.aborted) {
      const error = {
        version: "1",
        sessionId: parsed.data.sessionId,
        correlationId: parsed.data.correlationId,
        sequence: 1,
        type: "error",
        error: {
          version: "1",
          code: "agent_unavailable",
          message: "El agente no está disponible temporalmente",
          recoverable: true,
          hasPartialData: false,
          correlationId: parsed.data.correlationId,
        },
      };
      response.write(`${JSON.stringify(textAgentStreamEventSchema.parse(error))}\n`);
    }
  } finally {
    request.off("aborted", abort);
    response.off("close", abortOnPrematureClose);
    if (!response.writableEnded) response.end();
    logger.info("Agent API stream finalizado", {
      correlationId: parsed.data.correlationId,
      durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
      aborted: controller.signal.aborted,
    });
  }
}

async function handleFinancialSummary(
  request: IncomingMessage,
  response: ServerResponse,
  service: FinancialSummaryService,
  sessionFactory: SessionFactory,
): Promise<void> {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    const parsed = financialSummaryRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      writeError(response, 400, "invalid_request", "Solicitud inválida", false);
      return;
    }
    const result: FinancialSummaryResponse = await service(parsed.data, controller.signal, sessionFactory);
    writeJson(response, 200, result);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      writeError(response, 400, "invalid_request", "Solicitud inválida", false);
      return;
    }
    writeError(response, 502, "financial_data_unavailable", "No fue posible obtener los datos financieros", true);
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.end(JSON.stringify(body));
}

function writeError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  recoverable: boolean,
): void {
  writeJson(response, statusCode, errorPayloadSchema.parse({
    version: "1",
    code,
    message,
    recoverable,
    hasPartialData: false,
  }));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new InvalidJsonBodyError();
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

class InvalidJsonBodyError extends Error {}

function isProtectedRoute(request: IncomingMessage): boolean {
  return request.method === "POST"
    && (request.url === FINANCIAL_SUMMARY_PATH || request.url === AGENT_PATH || request.url === SNAPSHOT_PATH);
}

export async function createAuthenticatedRequestSessionFactory(
  request: Pick<IncomingMessage, "headers">,
  legacyApiToken: string | undefined,
  createUserSession: (accessToken: string) => Promise<AuthenticatedSupabaseSession>,
): Promise<SessionFactory | undefined> {
  const accessToken = readUserAccessToken(request, legacyApiToken);
  if (!accessToken) return undefined;

  try {
    const session = await createUserSession(accessToken);
    return async () => session;
  } catch {
    return undefined;
  }
}

function readUserAccessToken(
  request: Pick<IncomingMessage, "headers">,
  legacyApiToken?: string,
): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const bearerToken = normalizeAccessToken(header.slice("Bearer ".length));
  if (!bearerToken) return undefined;

  if (legacyApiToken && tokensMatch(bearerToken, legacyApiToken)) {
    const userToken = request.headers["x-supabase-access-token"];
    return typeof userToken === "string" ? normalizeAccessToken(userToken) : undefined;
  }

  return bearerToken;
}

function normalizeAccessToken(value: string): string | undefined {
  const token = value.trim();
  return token.length >= 20 && token.length <= 8_192 ? token : undefined;
}

function tokensMatch(receivedToken: string, expectedToken: string): boolean {
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  const receivedHash = createHash("sha256").update(receivedToken).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

function writeAuthenticationRequired(response: ServerResponse): void {
  response.setHeader("WWW-Authenticate", "Bearer");
  writeError(response, 401, "authentication_required", "Autenticación requerida", false);
}

function writeRateLimitExceeded(response: ServerResponse, error: RateLimitError): void {
  response.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
  writeError(response, 429, "rate_limited", "Límite de solicitudes alcanzado", true);
}
