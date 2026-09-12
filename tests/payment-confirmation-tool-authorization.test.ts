import assert from "node:assert/strict";
import test from "node:test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createPaymentConfirmationAuthorizer } from "../src/application/ports/payment-confirmation-authorization.js";
import {
  FinancialMcpClient,
  FinancialToolError,
} from "../src/agent/mcp-client/financial-mcp-client.js";
import { crearServidor } from "../src/server.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const intentId = "40000000-0000-4000-8000-000000000001";

test("el servidor MCP directo deniega confirm_payment por defecto", async () => {
  let rpcCalls = 0;
  const client = await connectClient(() => { rpcCalls += 1; });

  try {
    assert.equal((await client.listTools()).some((tool) => tool.name === "confirm_payment"), false);
    await assert.rejects(
      client.callTool(confirmCall()),
      FinancialToolError,
    );
    assert.equal(rpcCalls, 0);
  } finally {
    await client.close();
  }
});

test("la capacidad UI autoriza una sola confirmación para el actor e intent exactos", async () => {
  let rpcCalls = 0;
  const client = await connectClient(
    () => { rpcCalls += 1; },
    createPaymentConfirmationAuthorizer({
      actorId,
      paymentIntentId: intentId,
      sessionId: "session-payment-test",
      correlationId: "60000000-0000-4000-8000-000000000001",
      interfaceRevision: 2,
      dataRevision: 3,
    }),
  );

  try {
    const receipt = await client.callTool(confirmCall());
    assert.equal((receipt as { paymentIntentId?: string }).paymentIntentId, intentId);
    assert.equal(rpcCalls, 1);

    await assert.rejects(
      client.callTool(confirmCall()),
      (error: unknown) => (
        error instanceof FinancialToolError
        && error.code === "unauthorized"
      ),
    );
    assert.equal(rpcCalls, 1);
  } finally {
    await client.close();
  }
});

async function connectClient(
  onRpc: () => void,
  paymentConfirmationAuthorizer?: ReturnType<typeof createPaymentConfirmationAuthorizer>,
) {
  const databaseClient = {
    rpc: async (functionName: string) => {
      onRpc();
      assert.equal(functionName, "confirm_payment");
      return {
        data: [{
          payment_id: "50000000-0000-4000-8000-000000000001",
          payment_intent_id: intentId,
          status: "succeeded",
          receipt_number: "MOC-4000000000004000",
          amount: "1500.00",
          currency: "MXN",
          fee: "0.00",
          balance_before: "22500.00",
          balance_after: "21000.00",
          executed_at: "2026-09-12T06:50:00.000Z",
        }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  return FinancialMcpClient.connect(crearServidor(
    { client: databaseClient, user: { id: actorId } },
    {
      ...(paymentConfirmationAuthorizer ? { paymentConfirmationAuthorizer } : {}),
    },
  ));
}

function confirmCall() {
  return {
    name: "confirm_payment",
    arguments: { paymentIntentId: intentId, confirmed: true },
  };
}
