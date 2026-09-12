import assert from "node:assert/strict";
import test from "node:test";
import { type PaymentGateway } from "../src/application/ports/payment.js";
import { validateToolOutput } from "../src/agent/mcp-client/tool-output-validator.js";
import { isAllowedTool } from "../src/agent/tool-policy.js";
import { PaymentService } from "../src/services/payment.service.js";

const intentId = "40000000-0000-4000-8000-000000000001";
const sourceAccountId = "20000000-0000-4000-8000-000000000001";
const beneficiaryId = "30000000-0000-4000-8000-000000000001";
const generatedIds = [
  "42000000-0000-4000-8000-000000000001",
  "43000000-0000-4000-8000-000000000001",
];

test("genera idempotencia y correlación dentro del backend", async () => {
  let createKey: string | undefined;
  let confirmCorrelation: string | undefined;
  const gateway: PaymentGateway = {
    createIntent: async (command) => {
      createKey = command.idempotencyKey;
      return {
        id: intentId,
        sourceAccountId: command.sourceAccountId,
        beneficiaryId: command.beneficiaryId,
        amount: command.amount,
        currency: command.currency,
        concept: command.concept,
        fee: "0.00",
        estimatedBalanceAfter: "21000.00",
        status: "awaiting_confirmation",
        idempotencyKey: command.idempotencyKey,
        expiresAt: "2026-09-12T07:00:00.000Z",
      };
    },
    confirm: async (paymentIntentId, correlationId) => {
      confirmCorrelation = correlationId;
      return receipt(paymentIntentId);
    },
    getStatus: async (paymentIntentId) => ({
      paymentIntentId, status: "awaiting_confirmation", receiptNumber: null,
      amount: "1500.00", currency: "MXN", balanceAfter: null, executedAt: null,
    }),
    cancel: async (id) => ({ id, status: "cancelled", updatedAt: "2026-09-12T06:55:00.000Z" }),
  };
  const service = new PaymentService(gateway, () => generatedIds.shift()!);

  const intent = await service.createIntent({
    sourceAccountId,
    beneficiaryId,
    amount: "1500.00",
    currency: "MXN",
    concept: "Pago de prueba",
  });
  const result = await service.confirm({ paymentIntentId: intent.id, confirmed: true });

  assert.equal(createKey, "42000000-0000-4000-8000-000000000001");
  assert.equal(confirmCorrelation, "43000000-0000-4000-8000-000000000001");
  assert.equal(result.paymentIntentId, intentId);
  assert.deepEqual(validateToolOutput("create_payment_intent", intent), intent);
  assert.deepEqual(validateToolOutput("confirm_payment", result), result);
  for (const tool of [
    "get_beneficiaries",
    "create_payment_intent",
    "confirm_payment",
    "get_payment_status",
    "cancel_payment_intent",
  ]) assert.equal(isAllowedTool(tool), true);
});

function receipt(paymentIntentId: string) {
  return {
    paymentId: "50000000-0000-4000-8000-000000000001",
    paymentIntentId,
    status: "succeeded" as const,
    receiptNumber: "MOC-4000000000004000",
    amount: "1500.00",
    currency: "MXN",
    fee: "0.00",
    balanceBefore: "22500.00",
    balanceAfter: "21000.00",
    executedAt: "2026-09-12T06:50:00.000Z",
  };
}
