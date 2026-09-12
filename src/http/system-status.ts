import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSION,
  systemStatusSchema,
  type SystemStatus,
} from "@banorte/contracts";
import { env } from "../config/env.js";

export interface RuntimeCapabilities {
  isAgentReady: boolean;
  isMcpReady: boolean;
}

export function readRuntimeCapabilities(): RuntimeCapabilities {
  const hasSupabaseSession = Boolean(
    env.SUPABASE_URL
    && env.SUPABASE_PUBLISHABLE_KEY,
  );
  return {
    isAgentReady: Boolean(hasSupabaseSession && env.GEMINI_API_URL && env.GEMINI_API_KEY),
    isMcpReady: hasSupabaseSession,
  };
}

export function isAccessTokenFresh(
  token: string | undefined,
  now: () => number = Date.now,
): boolean {
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!claims || typeof claims !== "object") return false;
    const expiration = (claims as Record<string, unknown>).exp;
    return typeof expiration === "number"
      && Number.isInteger(expiration)
      && expiration * 1_000 > now();
  } catch {
    return false;
  }
}

export function createSystemStatus(
  capabilities: RuntimeCapabilities = readRuntimeCapabilities(),
  now: () => Date = () => new Date(),
): SystemStatus {
  const isReady = capabilities.isAgentReady && capabilities.isMcpReady;
  return systemStatusSchema.parse({
    version: CONTRACT_VERSION,
    contractFingerprint: CONTRACT_FINGERPRINT,
    status: isReady ? "ok" : "degraded",
    backend: "ready",
    agent: capabilities.isAgentReady ? "ready" : "unavailable",
    mcp: capabilities.isMcpReady ? "ready" : "unavailable",
    checkedAt: now().toISOString(),
  });
}
