import { type IncomingMessage, type ServerResponse } from "node:http";

const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "content-type",
  "x-supabase-access-token",
]);

const ROUTE_METHODS = new Map<string, readonly string[]>([
  ["/api/system/status", ["GET"]],
  ["/api/integration/financial-summary", ["POST"]],
  ["/api/agent", ["POST"]],
]);

export type HttpRequestDecision =
  | { kind: "continue" }
  | { kind: "responded" };

export function applyHttpSecurity(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): HttpRequestDecision {
  setSecurityHeaders(response);

  const origin = readSingleHeader(request.headers.origin);
  if (request.headers.origin !== undefined && !origin) {
    writeSecurityError(response, 400, "invalid_origin", "Origen inválido");
    return { kind: "responded" };
  }
  if (origin && !allowedOrigins.includes(origin)) {
    writeSecurityError(response, 403, "origin_not_allowed", "Origen no permitido");
    return { kind: "responded" };
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }

  const allowedMethods = ROUTE_METHODS.get(request.url ?? "");
  if (!allowedMethods) return { kind: "continue" };

  if (request.method === "OPTIONS") {
    handlePreflight(request, response, origin, allowedMethods);
    return { kind: "responded" };
  }

  if (!request.method || !allowedMethods.includes(request.method)) {
    response.setHeader("Allow", allowedMethods.join(", "));
    writeSecurityError(response, 405, "method_not_allowed", "Método no permitido");
    return { kind: "responded" };
  }

  return { kind: "continue" };
}

export function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.setHeader("Vary", "Origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function handlePreflight(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string | undefined,
  allowedMethods: readonly string[],
): void {
  const requestedMethod = readSingleHeader(request.headers["access-control-request-method"]);
  if (!origin || !requestedMethod) {
    writeSecurityError(response, 400, "invalid_preflight", "Preflight inválido");
    return;
  }
  if (!allowedMethods.includes(requestedMethod.toUpperCase())) {
    response.setHeader("Allow", allowedMethods.join(", "));
    writeSecurityError(response, 405, "method_not_allowed", "Método no permitido");
    return;
  }

  const requestedHeaders = readRequestedHeaders(request.headers["access-control-request-headers"]);
  if (!requestedHeaders || requestedHeaders.some((header) => !ALLOWED_REQUEST_HEADERS.has(header))) {
    writeSecurityError(response, 403, "headers_not_allowed", "Cabeceras no permitidas");
    return;
  }

  response.setHeader("Access-Control-Allow-Methods", allowedMethods.join(", "));
  response.setHeader("Access-Control-Allow-Headers", [...ALLOWED_REQUEST_HEADERS].join(", "));
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
  response.statusCode = 204;
  response.end();
}

function readRequestedHeaders(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return [];
  const header = readSingleHeader(value);
  if (!header) return undefined;
  const names = header.split(",").map((name) => name.trim().toLowerCase());
  return names.every((name) => name.length > 0) ? names : undefined;
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function writeSecurityError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  response.statusCode = statusCode;
  response.end(JSON.stringify({
    version: "1",
    code,
    message,
    recoverable: false,
    hasPartialData: false,
  }));
}
