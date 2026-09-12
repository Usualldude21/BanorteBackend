import assert from "node:assert/strict";
import test from "node:test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createPaymentWriteAuthorizer } from "../src/application/ports/payment-write-authorization.js";
import {
  FinancialMcpClient,
  FinancialToolError,
} from "../src/agent/mcp-client/financial-mcp-client.js";
import { crearServidor } from "../src/server.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000001";
const beneficiaryId = "30000000-0000-4000-8000-000000000001";
const intentId = "40000000-0000-4000-8000-000000000001";
const otherIntentId = "40000000-0000-4000-8000-000000000099";

test("el servidor MCP directo deniega create y cancel por defecto", async () => {
  let rpcCalls = 0;
  const client = await connectClient(() => { rpcCalls += 1; });

  try {
    const tools = await client.listTools();
    assert.equal(tools.some((tool) => tool.name === "create_payment_intent"), false);
    assert.equal(tools.some((tool) => tool.name === "cancel_payment_intent"), false);
    await assert.rejects(client.callTool(createCall()), FinancialToolError);
    await assert.rejects(client.callTool(cancelCall(intentId)), FinancialToolError);
    assert.equal(rpcCalls, 0);
  } finally {
    await client.close();
  }
});

test("las capacidades WRITE son de un solo uso y cancel queda ligado al intent", async () => {
  let rpcCalls = 0;
  const client = await connectClient(
    () => { rpcCalls += 1; },
    createPaymentWriteAuthorizer({
      actorId,
      sessionId: "payment-write-session",
      correlationId: "60000000-0000-4000-8000-000000000001",
      interfaceRevision: 1,
      dataRevision: 2,
      permissions: [
        { toolName: "create_payment_intent" },
        { toolName: "cancel_payment_intent", paymentIntentId: intentId },
      ],
    }),
  );

  try {
    await client.callTool(createCall());
    await assertUnauthorized(client.callTool(createCall()));
    await assertUnauthorized(client.callTool(cancelCall(otherIntentId)));
    await client.callTool(cancelCall(intentId));
    await assertUnauthorized(client.callTool(cancelCall(intentId)));
    assert.equal(rpcCalls, 2);
  } finally {
    await client.close();
  }
});

async function assertUnauthorized(operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => (
    error instanceof FinancialToolError && error.code === "unauthorized"
  ));
}

async function connectClient(
  onRpc: () => void,
  paymentWriteAuthorizer?: ReturnType<typeof createPaymentWriteAuthorizer>,
) {
  const databaseClient = {
    rpc: async (functionName: string, parameters: Record<string, unknown>) => {
      onRpc();
      if (functionName === "create_payment_intent") {
        return {
          data: [{
            id: intentId,
            source_account_id: accountId,
            beneficiary_id: beneficiaryId,
            amount: "500.00",
            currency: "MXN",
            concept: "Prueba",
            fee: "0.00",
            estimated_balance_after: "22000.00",
            status: "awaiting_confirmation",
            idempotency_key: parameters.p_idempotency_key,
            expires_at: "2026-09-12T08:00:00.000Z",
          }],
          error: null,
        };
      }
      assert.equal(functionName, "cancel_payment_intent");
      return {
        data: [{
          id: parameters.p_payment_intent_id,
          status: "cancelled",
          updated_at: "2026-09-12T07:00:00.000Z",
        }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  return FinancialMcpClient.connect(crearServidor(
    { client: databaseClient, user: { id: actorId } },
    { ...(paymentWriteAuthorizer ? { paymentWriteAuthorizer } : {}) },
  ));
}

function createCall() {
  return {
    name: "create_payment_intent",
    arguments: {
      sourceAccountId: accountId,
      beneficiaryId,
      amount: "500.00",
      currency: "MXN",
      concept: "Prueba",
    },
  };
}

function cancelCall(paymentIntentId: string) {
  return {
    name: "cancel_payment_intent",
    arguments: { paymentIntentId },
  };
}
