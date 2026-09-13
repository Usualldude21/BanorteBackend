import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeHarness, queryRequest } from "./support/challenge-harness.js";
import {
  createIntentAwareEarlyUiPayload,
  createProvisionalUiPayload,
} from "../src/integration/shared-ui-stream.js";

test("I6 emite DataPatch antes de la primera UI que consume sus bindings", async () => {
  const harness = new ChallengeHarness();
  const events = await harness.run(queryRequest(
    "33000000-0000-4000-8000-000000000001",
    "44000000-0000-4000-8000-000000000001",
    "¿En qué se me está yendo el dinero?",
  ));
  const dataIndex = events.findIndex((event) => event.type === "data-patch");
  const uiIndex = events.findIndex((event) => event.type === "ui-started" || event.type === "ui");
  const completedIndex = events.findIndex((event) => event.type === "ui-completed");
  const planningIndex = events.findIndex((event) => event.type === "status" && event.status.stage === "generating_ui");

  assert.ok(dataIndex >= 0, "debe existir un DataPatch");
  assert.ok(uiIndex > dataIndex, "la UI inicial debe llegar después de sus datos");
  assert.ok(uiIndex > planningIndex, "la UI real no debe adelantarse al planificador");
  assert.ok(completedIndex > uiIndex, "la primera UI útil debe preceder al cierre");
  assert.equal(events.slice(0, planningIndex).filter((event) => event.type === "ui-started").length, 0);

  const initialUI = events[uiIndex];
  assert.ok(initialUI?.type === "ui-started" || initialUI?.type === "ui");
  assert.equal(initialUI.specification.root.type, "visualization");
  assert.equal(events.slice(0, completedIndex).filter((event) => event.type === "ui-started").length, 1);
});

test("GEN4 mantiene feedback inmediato y no publica UI falsa con planificador lento", async () => {
  const harness = new ChallengeHarness({ uiGenerationDelayMs: 250 });
  const request = queryRequest(
    "33000000-0000-4000-8000-000000000002",
    "44000000-0000-4000-8000-000000000002",
    "¿Qué categorías presionaron más mis gastos de agosto?",
  );
  const startedAt = performance.now();
  const observed: Array<{ type: string; atMs: number }> = [];
  for await (const event of harness.service(request)) {
    observed.push({ type: event.type, atMs: performance.now() - startedAt });
  }

  const firstFeedback = observed[0];
  const firstUi = observed.find((event) => event.type === "ui-started");
  const finalUi = observed.find((event) => event.type === "ui-completed");
  assert.equal(firstFeedback?.type, "started");
  assert.ok(firstFeedback.atMs < 500, "el primer feedback debe llegar antes de 500 ms");
  assert.ok(firstUi && firstUi.atMs >= 200, "la UI no debe anticiparse al planificador lento");
  assert.ok(finalUi && finalUi.atMs >= firstUi.atMs);
  assert.equal(observed.filter((event) => event.type === "ui-started").length, 1);
});

test("GEN4 publica una sola vista final al consultar nuevos datos en el mismo hilo", async () => {
  const harness = new ChallengeHarness();
  const sessionId = "33000000-0000-4000-8000-000000000003";
  await harness.run(queryRequest(sessionId, "44000000-0000-4000-8000-000000000003", "¿En qué gasté más?"));
  const previous = harness.sessions.latest();
  const events = await harness.run(queryRequest(
    sessionId,
    "44000000-0000-4000-8000-000000000004",
    "¿Cuál es el saldo disponible en mis cuentas?",
    previous,
  ));
  const replacements = events.filter((event) => event.type === "ui-started");
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0]?.revision, previous.interfaceRevision + 1);
  assert.equal(events.filter((event) => event.type === "ui-patch").length, 0);
  assert.ok(events.some((event) => event.type === "ui-completed"));
});

test("BP6.5 evita una tabla provisional que sólo muestre la moneda", () => {
  const preview = createProvisionalUiPayload({
    id: "source-1", toolName: "compare_periods", data: {
      comparisons: [{ currency: "MXN", expenses: { previousValue: "20650.00", currentValue: "27600.00" } }],
      dataType: "OBSERVED",
    },
  }, 1);
  assert.equal(preview, null);
});

test("BP6.5 adelanta una UI semántica enlazada y no una tabla genérica", () => {
  const payload = createIntentAwareEarlyUiPayload({
    query: "¿Cuánto tengo disponible en mis cuentas MXN?",
    dataSources: [{
      id: "source-1",
      toolName: "get_accounts",
      data: {
        accounts: [{
          id: "40000000-0000-4000-8000-000000000001",
          name: "Cuenta principal",
          type: "checking",
          status: "active",
          currency: "MXN",
          balance: "22500.00",
          availableBalance: "21300.00",
          maskedIdentifier: "****1234",
        }],
        metadata: { totalAccounts: 1, queriedAt: "2026-09-12T00:00:00.000Z" },
      },
    }],
    revision: 1,
    currentDate: "2026-09-12",
    experienceScope: "personal_banking",
  });

  assert.ok(payload);
  assert.equal(payload.specification.root.id, "accounts-summary");
  assert.ok(Object.hasOwn(payload.dataRegistry.data, "source_1"));
});

test("BP6.5 no adelanta una composición incompleta para una comparación", () => {
  const payload = createIntentAwareEarlyUiPayload({
    query: "Compara mis gastos de julio y agosto de 2026 por categoría y explícame las variaciones",
    dataSources: [{
      id: "source-1",
      toolName: "get_spending_by_category",
      data: {
        categories: [{ currency: "MXN", category: "restaurants", amount: "1000.00", percentage: "20", transactionCount: 2 }],
        metadata: { startDate: "2026-08-01", endDate: "2026-08-31", queriedAt: "2026-09-12T00:00:00.000Z" },
      },
    }],
    revision: 1,
    currentDate: "2026-09-12",
    experienceScope: "personal_banking",
  });

  assert.equal(payload, null);
});
