import assert from "node:assert/strict";
import test from "node:test";
import { AgentSessionStore } from "../src/integration/agent-session-store.js";
import { adaptUiPayload } from "../src/integration/shared-contract-adapter.js";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { createIntentAwareUiFallback } from "../src/ui/generation/intent-aware-ui-fallback.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const intentId = "40000000-0000-4000-8000-000000000001";

test("L11 los select de captura requieren elección explícita sin valor inicial", () => {
  const document = parseUiDocument({ version: "1.0", root: { type: "form", id: "capture", title: "Preparar pago", submitLabel: "Revisar pago", fields: [
    { type: "select", id: "source", label: "Origen", options: [{ value: "checking", label: "Principal" }] },
    { type: "select", id: "destination", label: "Destino", options: [{ value: "family", label: "Ahorro Familiar" }] },
  ] } }, []);
  const shared = adaptUiPayload(document, []);
  if (shared.specification.root.type !== "stack") throw new Error("Expected stack");
  const selects = shared.specification.root.children.filter((node) => node.type === "select");
  assert.equal(selects.length, 2);
  for (const select of selects) {
    if (select.type !== "select") throw new Error("Expected select");
    assert.equal(select.required, true);
    assert.equal(select.initialValue, undefined);
    assert.equal(select.placeholder, "Selecciona una opción");
  }
});

test("la sesión conserva y después elimina el intent pendiente", async () => {
  const store = new AgentSessionStore(() => 1_000);
  const first = await store.begin({ actorId, sessionId: "session-1", correlationId: "correlation-1" });
  assert.equal(first.success, true);
  await store.complete({
    actorId,
    sessionId: "session-1",
    correlationId: "correlation-1",
    interfaceRevision: 1,
    dataRevision: 1,
    dataKeys: ["source_1"],
    answer: "Pago preparado",
    pendingPaymentIntentId: intentId,
  });

  const second = await store.begin({
    actorId,
    sessionId: "session-1",
    correlationId: "correlation-2",
    reference: { interfaceRevision: 1, dataRevision: 1, dataKeys: ["source_1"] },
  });
  assert.equal(second.success, true);
  if (!second.success) return;
  assert.equal(second.state.pendingPaymentIntentId, intentId);
  await store.complete({
    actorId,
    sessionId: "session-1",
    correlationId: "correlation-2",
    interfaceRevision: 2,
    dataRevision: 2,
    dataKeys: ["source_2"],
    answer: "Pago confirmado",
    pendingPaymentIntentId: null,
  });

  const third = await store.begin({
    actorId,
    sessionId: "session-1",
    correlationId: "correlation-3",
    reference: { interfaceRevision: 2, dataRevision: 2, dataKeys: ["source_2"] },
  });
  assert.equal(third.success, true);
  if (third.success) assert.equal(third.state.pendingPaymentIntentId, undefined);
});

test("la UI de respaldo emite una confirmación de pago validada", () => {
  const sources: UiDataSource[] = [{
    id: "source-1",
    toolName: "create_payment_intent",
    data: {
      id: intentId,
      sourceAccountId: "40000000-0000-4000-8000-000000000001",
      beneficiaryId: "60000000-0000-4000-8000-000000000001",
      amount: "1500.00",
      currency: "MXN",
      concept: "Prueba L11",
      fee: "0.00",
      estimatedBalanceAfter: "21000.00",
      status: "awaiting_confirmation",
      idempotencyKey: "42000000-0000-4000-8000-000000000001",
      expiresAt: "2026-09-12T23:00:00.000Z",
    },
  }, {
    id: "source-2", toolName: "get_accounts", data: { accounts: [{
      id: "40000000-0000-4000-8000-000000000001", name: "Cuenta principal", status: "active", type: "checking",
    }] },
  }, {
    id: "source-3", toolName: "get_beneficiaries", data: { beneficiaries: [{
      id: "60000000-0000-4000-8000-000000000001", name: "Servicios del Hogar", status: "active",
    }] },
  }];
  const ui = createIntentAwareUiFallback("Prepara un pago", sources);
  assert.ok(ui);
  assert.doesNotThrow(() => parseUiDocument(ui, sources));
  assert.deepEqual(validateUiSemantics("Prepara un pago", ui, sources), {
    success: true,
    issues: [],
  });

  const shared = adaptUiPayload(ui, sources);
  const serialized = JSON.stringify(shared.specification);
  assert.match(serialized, /"event":"payment.confirmed"/u);
  assert.match(serialized, /Confirmar pago/u);
  const sharedData = shared.dataRegistry.data.source_1 as Record<string, unknown>;
  assert.equal(sharedData.amount, 1500);
  assert.equal(sharedData.estimatedBalanceAfter, 21000);
  assert.equal(sharedData.idempotencyKey, undefined);
  assert.equal(sharedData.id, undefined);
});

test("L11 rechaza un comprobante sin folio o con saldo todavía estimado", () => {
  const sources: UiDataSource[] = [{ id: "source-1", toolName: "confirm_payment", data: {
    paymentId: "70000000-0000-4000-8000-000000000001", paymentIntentId: intentId,
    status: "succeeded", receiptNumber: "DEMO-123", amount: "503.00", currency: "MXN",
    fee: "0.00", balanceBefore: "22499.00", balanceAfter: "21996.00", executedAt: "2026-09-12T21:00:00.000Z",
  } }];
  const valid = createIntentAwareUiFallback("Pago confirmado", sources);
  assert.ok(valid);
  assert.deepEqual(validateUiSemantics("Pago confirmado", valid, sources), { success: true, issues: [] });
  const invalid = structuredClone(valid);
  assert.equal(invalid.root.type, "card");
  if (invalid.root.type !== "card") return;
  invalid.root.children = invalid.root.children.filter((node) => node.id !== "receipt-number");
  const issue = validateUiSemantics("Pago confirmado", invalid, sources);
  assert.equal(issue.success, false);
  if (!issue.success) assert.ok(issue.issues.some((item) => item.code === "payment_receipt_required"));
});

test("el comprobante conserva una UI válida si el planner falla después del pago", () => {
  const sources: UiDataSource[] = [{
    id: "source-1",
    toolName: "confirm_payment",
    data: {
      paymentId: "50000000-0000-4000-8000-000000000001",
      paymentIntentId: intentId,
      status: "succeeded",
      receiptNumber: "MOC-4000000000004000",
      amount: "1500.00",
      currency: "MXN",
      fee: "0.00",
      balanceBefore: "22500.00",
      balanceAfter: "21000.00",
      executedAt: "2026-09-12T06:50:00.000Z",
    },
  }];

  const ui = createIntentAwareUiFallback("Pago confirmado", sources);

  assert.ok(ui);
  assert.doesNotThrow(() => parseUiDocument(ui, sources));
  assert.deepEqual(validateUiSemantics("Pago confirmado", ui, sources), {
    success: true,
    issues: [],
  });
});
