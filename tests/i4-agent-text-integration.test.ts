import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import test from "node:test";
import {
  textAgentRequestSchema,
  textAgentStreamEventSchema,
  type TextAgentStreamEvent,
} from "@banorte/contracts";
import { createSystemApi } from "../src/http/system-api.js";
import { type TextAgentService } from "../src/integration/text-agent-service.js";
import {
  ChallengeHarness,
  queryRequest,
} from "./support/challenge-harness.js";

const SESSION_ID = "12000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "22000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "i4-user-access-token-with-sufficient-length";

test("responseMode text conserva MCP y texto sin emitir eventos UI", async () => {
  const harness = new ChallengeHarness();
  const request = textAgentRequestSchema.parse({
    ...queryRequest(SESSION_ID, CORRELATION_ID, "¿En qué gasté más este mes?"),
    responseMode: "text",
  });

  const events = await harness.run(request);

  assert.deepEqual(harness.toolCalls.map((call) => call.name), ["get_spending_by_category"]);
  assert.ok(events.some((event) => event.type === "data-patch"));
  assert.ok(events.some((event) => event.type === "text-delta"));
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(events.some(isUiEvent), false);
  assert.equal(events.some((event) => event.type === "status" && event.status.stage === "generating_ui"), false);
  assert.equal(harness.sessions.latest().specification, undefined);
});

test("cerrar el consumidor HTTP aborta la ejecución activa del agente", async (context) => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let markAborted!: () => void;
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  const textAgent: TextAgentService = async function* (request, signal) {
    yield textAgentStreamEventSchema.parse({
      version: "1",
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      sequence: 1,
      type: "started",
    });
    markStarted();
    await new Promise<void>((resolve) => {
      const finish = () => {
        markAborted();
        resolve();
      };
      if (signal?.aborted) finish();
      else signal?.addEventListener("abort", finish, { once: true });
    });
  };
  const api = createSystemApi({
    textAgent,
    createUserSession: async () => ({
      client: {} as never,
      user: { id: "10000000-0000-4000-8000-000000000001" },
    }),
  });
  context.after(() => api.close());
  const baseUrl = await listen(api);
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(textAgentRequestSchema.parse({
      version: "1",
      sessionId: SESSION_ID,
      correlationId: CORRELATION_ID,
      provider: "google",
      responseMode: "text",
      query: "¿Cuánto tengo disponible?",
    })),
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  await reader.read();
  await started;

  controller.abort();

  await waitWithTimeout(aborted, 1_000);
  assert.equal(controller.signal.aborted, true);
});

function isUiEvent(event: TextAgentStreamEvent): boolean {
  return event.type === "ui-started" || event.type === "ui-patch" || event.type === "ui-completed";
}

async function listen(api: ReturnType<typeof createSystemApi>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(0, "127.0.0.1", resolve);
  });
  const address = api.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("El backend no observó la cancelación")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
