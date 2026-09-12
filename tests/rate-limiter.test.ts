import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type SupabaseClient } from "@supabase/supabase-js";
import { type AuthenticatedSupabaseSession } from "../src/config/supabase.js";
import { RateLimitError } from "../src/application/errors/rate-limit.error.js";
import { ToolRateLimiter } from "../src/application/tool-rate-limiter.js";
import { createSystemApi } from "../src/http/system-api.js";
import {
  FinancialMcpClient,
  FinancialToolError,
} from "../src/agent/mcp-client/financial-mcp-client.js";
import { crearServidor } from "../src/server.js";

test("comparte contadores entre scopes derivados y aísla usuarios", () => {
  let now = 1_000;
  const limiter = new ToolRateLimiter({
    maxCalls: 2,
    windowMs: 1_000,
    now: () => now,
  });

  limiter.forScope("user-a").consume("get_accounts");
  limiter.forScope("user-a").consume("get_accounts");
  assert.throws(
    () => limiter.forScope("user-a").consume("get_accounts"),
    (error: unknown) => error instanceof RateLimitError && error.retryAfterMs === 1_000,
  );
  assert.doesNotThrow(() => limiter.forScope("user-b").consume("get_accounts"));

  now = 2_001;
  assert.doesNotThrow(() => limiter.forScope("user-a").consume("get_accounts"));
});

test("aplica un límite menor a operaciones WRITE", () => {
  const limiter = new ToolRateLimiter({
    maxCalls: 3,
    windowMs: 60_000,
    policyForOperation: (operation) => operation === "confirm_payment"
      ? { maxCalls: 1, windowMs: 60_000 }
      : undefined,
  }).forScope("user-a");

  limiter.consume("get_accounts");
  limiter.consume("get_accounts");
  limiter.consume("confirm_payment");
  assert.throws(() => limiter.consume("confirm_payment"), RateLimitError);
  assert.doesNotThrow(() => limiter.consume("get_accounts"));
});

test("conserva el límite MCP al recrear el runtime del mismo usuario", async () => {
  const limiter = new ToolRateLimiter({ maxCalls: 1, windowMs: 60_000 });
  const first = await connectStatusClient("user-a", limiter);
  const second = await connectStatusClient("user-a", limiter);
  const otherUser = await connectStatusClient("user-b", limiter);

  try {
    await first.callTool(statusCall());
    await assert.rejects(
      second.callTool(statusCall()),
      (error: unknown) => error instanceof FinancialToolError && error.code === "rate_limited",
    );
    await assert.doesNotReject(otherUser.callTool(statusCall()));
  } finally {
    await Promise.all([first.close(), second.close(), otherUser.close()]);
  }
});

test("la API limita autenticación por red y peticiones costosas por usuario", async () => {
  const authenticationRateLimiter = new ToolRateLimiter({ maxCalls: 2, windowMs: 60_000 });
  const requestRateLimiter = new ToolRateLimiter({ maxCalls: 1, windowMs: 60_000 });
  const server = createSystemApi({
    authenticationRateLimiter,
    requestRateLimiter,
    createUserSession: async (token) => session(token.endsWith("a") ? "user-a" : "user-b"),
    financialSummary: async (request) => ({
      version: "1",
      correlationId: request.correlationId,
      dataRegistry: { version: "1", revision: 0, data: {} },
    }),
  });

  const first = await dispatch(server, "valid-supabase-access-token-user-a", "10.0.0.1");
  assert.equal(first.statusCode, 200);

  const sameUser = await dispatch(server, "valid-supabase-access-token-user-a", "10.0.0.1");
  assert.equal(sameUser.statusCode, 429);
  assert.equal(sameUser.headers["Retry-After"], "60");

  const networkLimited = await dispatch(server, "valid-supabase-access-token-user-b", "10.0.0.1");
  assert.equal(networkLimited.statusCode, 429);

  const otherNetworkAndUser = await dispatch(server, "valid-supabase-access-token-user-b", "10.0.0.2");
  assert.equal(otherNetworkAndUser.statusCode, 200);
  server.removeAllListeners();
});

function session(userId: string): AuthenticatedSupabaseSession {
  return {
    client: {} as AuthenticatedSupabaseSession["client"],
    user: { id: userId },
  };
}

function connectStatusClient(userId: string, rateLimiter: ToolRateLimiter) {
  const client = {
    rpc: async () => ({
      data: [{
        payment_intent_id: "40000000-0000-4000-8000-000000000001",
        status: "awaiting_confirmation",
        receipt_number: null,
        amount: "500.00",
        currency: "MXN",
        balance_after: null,
        executed_at: null,
      }],
      error: null,
    }),
  } as unknown as SupabaseClient;
  return FinancialMcpClient.connect(crearServidor(
    { client, user: { id: userId } },
    { rateLimiter },
  ));
}

function statusCall() {
  return {
    name: "get_payment_status",
    arguments: { paymentIntentId: "40000000-0000-4000-8000-000000000001" },
  };
}

function dispatch(
  server: ReturnType<typeof createSystemApi>,
  accessToken: string,
  remoteAddress: string,
): Promise<{ statusCode: number; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/api/integration/financial-summary",
      headers: { authorization: `Bearer ${accessToken}` },
      socket: { remoteAddress },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({
          version: "1",
          correlationId: "20000000-0000-4000-8000-000000000001",
          startDate: "2026-09-01",
          endDate: "2026-09-12",
          currency: "MXN",
        }));
      },
    }) as unknown as IncomingMessage;
    const response = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end() {
        this.writableEnded = true;
        resolve({ statusCode: this.statusCode, headers });
      },
    } as unknown as ServerResponse;

    server.emit("request", request, response);
  });
}
