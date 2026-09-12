import assert from "node:assert/strict";
import test from "node:test";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import { type FinancialToolClient } from "../src/agent/mcp-client/financial-mcp-client.js";
import { type ModelGateway } from "../src/agent/model/model.js";
import { type AgentToolCall, type AgentToolResult } from "../src/agent/schemas/agent.schema.js";
import { type UiGenerator } from "../src/ui/generation/ui-generator.js";

const intentId = "40000000-0000-4000-8000-000000000001";

test("rechaza confirm_payment si no proviene de la UI autorizada", async () => {
  let calls = 0;
  const orchestrator = createOrchestrator(intentId, () => { calls += 1; });
  const events = [];

  for await (const event of orchestrator.stream("Confirma el pago")) events.push(event);

  assert.equal(calls, 0);
  assert.equal(events.at(-1)?.type, "error");
});

test("rechaza un intent distinto aunque exista confirmación UI", async () => {
  let calls = 0;
  const otherIntent = "40000000-0000-4000-8000-000000000099";
  const orchestrator = createOrchestrator(otherIntent, () => { calls += 1; });
  const events = [];

  for await (const event of orchestrator.stream("Interacción payment.confirmed", {
    paymentConfirmationIntentId: intentId,
  })) events.push(event);

  assert.equal(calls, 0);
  assert.equal(events.at(-1)?.type, "error");
});

test("permite únicamente el intent exacto autorizado por la UI", async () => {
  let calls = 0;
  const orchestrator = createOrchestrator(intentId, () => { calls += 1; });

  const response = await orchestrator.answer("Interacción payment.confirmed", {
    paymentConfirmationIntentId: intentId,
  });

  assert.equal(calls, 1);
  assert.deepEqual(response.toolsUsed, ["confirm_payment"]);
  assert.equal((response.dataSources[0]?.data as { paymentIntentId?: string }).paymentIntentId, intentId);
});

function createOrchestrator(paymentIntentId: string, onCall: () => void) {
  const call: AgentToolCall = {
    name: "confirm_payment",
    arguments: { paymentIntentId, confirmed: true },
  };
  const model: ModelGateway = {
    createSession: () => {
      let turn = 0;
      return {
        next: async (_results?: AgentToolResult[]) => {
          turn += 1;
          return turn === 1
            ? { text: "", toolCalls: [call] }
            : { text: "El pago fue confirmado y el comprobante proviene de la base de datos.", toolCalls: [] };
        },
      };
    },
  };
  const tools: FinancialToolClient = {
    listTools: async () => [{
      name: "confirm_payment",
      description: "Confirma un pago autorizado",
      inputSchema: { type: "object" },
    }],
    callTool: async () => {
      onCall();
      return {
        paymentId: "50000000-0000-4000-8000-000000000001",
        paymentIntentId,
        status: "succeeded",
        receiptNumber: "MOC-4000000000004000",
        amount: "1500.00",
        currency: "MXN",
        fee: "0.00",
        balanceBefore: "22500.00",
        balanceAfter: "21000.00",
        executedAt: "2026-09-12T06:50:00.000Z",
      };
    },
  };
  const uiGenerator: UiGenerator = {
    generate: async () => ({
      version: "1.0",
      root: { id: "receipt", type: "text", text: "Pago confirmado", variant: "body" },
    }),
  };
  return new AgentOrchestrator(model, tools, uiGenerator, {
    maxToolCalls: 2,
    currentDate: () => "2026-09-12",
  });
}
