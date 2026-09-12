import assert from "node:assert/strict";
import test from "node:test";
import { paymentWritePermissionsForQuery } from "../src/agent/payment-write-policy.js";
import {
  financialToolRisk,
  selectAllowedTools,
} from "../src/agent/tool-policy.js";

const pendingIntentId = "40000000-0000-4000-8000-000000000001";

test("clasifica herramientas READ, WRITE y CRITICAL_WRITE", () => {
  assert.equal(financialToolRisk("get_accounts"), "read");
  assert.equal(financialToolRisk("simulate_savings"), "read");
  assert.equal(financialToolRisk("create_payment_intent"), "write");
  assert.equal(financialToolRisk("cancel_payment_intent"), "write");
  assert.equal(financialToolRisk("confirm_payment"), "critical-write");
  assert.equal(financialToolRisk("unknown_tool"), undefined);
});

test("expone al modelo únicamente las herramientas autorizadas para la solicitud", () => {
  const definitions = [
    definition("get_accounts"),
    definition("create_payment_intent"),
    definition("cancel_payment_intent"),
    definition("confirm_payment"),
  ];
  const selected = selectAllowedTools(definitions, ["get_accounts", "create_payment_intent"]);
  assert.deepEqual(selected.map((tool) => tool.name), ["get_accounts", "create_payment_intent"]);
});

test("autoriza escrituras solamente para una intención explícita y contextual", () => {
  assert.deepEqual(paymentWritePermissionsForQuery("Muéstrame mis cuentas", pendingIntentId), []);
  assert.deepEqual(paymentWritePermissionsForQuery("Transfiere 500 pesos a Ana"), []);
  assert.deepEqual(paymentWritePermissionsForQuery("Cancela el pago pendiente", pendingIntentId), [
    { toolName: "cancel_payment_intent", paymentIntentId: pendingIntentId },
  ]);
  assert.deepEqual(paymentWritePermissionsForQuery("Cancela el pago pendiente"), []);
});

function definition(name: string) {
  return { name, description: name, inputSchema: { type: "object" } };
}
