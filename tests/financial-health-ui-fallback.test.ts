import assert from "node:assert/strict";
import test from "node:test";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { GeminiUiGenerator } from "../src/ui/generation/gemini-ui-generator.js";
import { createIntentAwareUiFallback } from "../src/ui/generation/intent-aware-ui-fallback.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

test("crea una interfaz válida cuando falla el UI Planner para salud financiera", () => {
  const sources: UiDataSource[] = [{
    id: "source-1",
    toolName: "evaluate_financial_health",
    data: {
      dataType: "OBSERVED",
      health: [{
        currency: "MXN",
        score: 46,
        status: "attention",
        totalLiquidBalance: "15000.00",
        savingsRate: "20.00",
        metrics: { averageMonthlyMargin: "2000.00" },
      }],
    },
  }];

  const fallback = createIntentAwareUiFallback("Evalúa mi salud financiera", sources);

  assert.ok(fallback);
  assert.doesNotThrow(() => parseUiDocument(fallback, sources));
  assert.equal(fallback.root.type, "card");
  if (fallback.root.type !== "card") return;
  const scoreMetric = fallback.root.children.find((node) => node.id === "health-score");
  assert.deepEqual(scoreMetric, {
    id: "health-score",
    type: "metric",
    label: "Puntuación financiera",
    value: { sourceId: "source-1", path: "health.0.score" },
    format: "percentage",
  });
  assert.deepEqual(validateUiSemantics("Evalúa mi salud financiera", fallback, sources), {
    success: true,
    issues: [],
  });
});

test("crea una interfaz válida cuando no hay evaluación disponible", () => {
  const sources: UiDataSource[] = [{
    id: "source-1",
    toolName: "evaluate_financial_health",
    data: { dataType: "OBSERVED", health: [] },
  }];

  const fallback = createIntentAwareUiFallback("Evalúa mi salud financiera", sources);

  assert.ok(fallback);
  assert.doesNotThrow(() => parseUiDocument(fallback, sources));
  assert.deepEqual(validateUiSemantics("Evalúa mi salud financiera", fallback, sources), {
    success: true,
    issues: [],
  });
});

test("no sustituye un análisis de gastos por salud financiera sólo porque esa fuente esté disponible", () => {
  const healthSource: UiDataSource = {
    id: "source-1",
    toolName: "evaluate_financial_health",
    data: {
      dataType: "OBSERVED",
      health: [{
        currency: "MXN",
        score: 36,
        status: "critical",
        totalLiquidBalance: "40499.00",
        savingsRate: "25.05",
        metrics: { averageMonthlyMargin: "5637.25" },
      }],
    },
  };

  assert.equal(createIntentAwareUiFallback("¿En qué se me está yendo el dinero?", [healthSource]), undefined);
  assert.ok(createIntentAwareUiFallback("Explícame por qué no logro ahorrar", [healthSource]));
});

test("un fallback de pago tiene prioridad sobre una fuente auxiliar de salud", () => {
  const fallback = createIntentAwareUiFallback("Confirma el pago que revisé", [
    {
      id: "source-1",
      toolName: "evaluate_financial_health",
      data: { dataType: "OBSERVED", health: [] },
    },
    {
      id: "source-2",
      toolName: "confirm_payment",
      data: {
        receiptNumber: "receipt-1",
        amount: "500.00",
        fee: "0.00",
        balanceAfter: "39999.00",
        currency: "MXN",
        status: "succeeded",
      },
    },
  ]);

  assert.equal(fallback?.root.id, "payment-receipt-card");
});

test("GEN3 recupera la solicitud B3 tras agotar tres JSON inválidos de Gemini", async () => {
  let fetchCalls = 0;
  const generator = new GeminiUiGenerator({
    apiUrl: "https://generativelanguage.googleapis.com",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1_000,
  }, async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{}" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const sources: UiDataSource[] = [{
    id: "source-1",
    toolName: "evaluate_financial_health",
    data: {
      dataType: "OBSERVED",
      health: [{
        currency: "MXN",
        score: 46,
        status: "attention",
        totalLiquidBalance: "15000.00",
        savingsRate: "20.00",
        metrics: { averageMonthlyMargin: "2000.00" },
      }],
    },
  }];

  const document = await generator.generate({
    query: "Evalúa mi salud financiera",
    answer: "Evaluación financiera calculada.",
    dataSources: sources,
  });

  assert.equal(fetchCalls, 3);
  assert.equal(document.root.id, "financial-health-card");
  assert.doesNotThrow(() => parseUiDocument(document, sources));
});
