import assert from "node:assert/strict";
import test from "node:test";
import { parseUiDocument, resolveUiDataReference, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { COMPARISON_CATEGORY_VIEW_SOURCE, shapeFinancialDataForIntent } from "../src/agent/reasoning/financial-intent-data-shaper.js";
import { adaptUiPayload } from "../src/integration/shared-contract-adapter.js";
import { GeminiUiGenerator } from "../src/ui/generation/gemini-ui-generator.js";
import { createIntentAwareUiFallback } from "../src/ui/generation/intent-aware-ui-fallback.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const accountId = "40000000-0000-4000-8000-000000000001";
const transactionId = "50000000-0000-4000-8000-000000000001";

const accounts: UiDataSource = {
  id: "accounts-source",
  toolName: "get_accounts",
  data: {
    accounts: [{ id: accountId, type: "checking", status: "active", name: "Cuenta principal", currency: "MXN", balance: "22500.00", maskedIdentifier: "****1234" }],
    metadata: { totalAccounts: 1, queriedAt: "2026-09-12T00:00:00.000Z" },
  },
};

const comparison: UiDataSource = {
  id: "comparison-source",
  toolName: "compare_periods",
  data: {
    comparisons: [{
      currency: "MXN",
      income: change("10000.00", "11000.00"),
      expenses: change("4300.00", "5600.00"),
      netCashFlow: change("5700.00", "5400.00"),
      savingsRate: change("57.00", "49.00"),
      categories: [
        { category: "Restaurantes", change: change("900.00", "1700.00") },
        { category: "Transporte", change: change("800.00", "700.00") },
      ],
    }],
    metadata: {
      queriedAt: "2026-09-12T00:00:00.000Z",
      previousPeriod: { startDate: "2026-07-01", endDate: "2026-07-31" },
      currentPeriod: { startDate: "2026-08-01", endDate: "2026-08-31" },
    },
  },
};

const categories: UiDataSource = {
  id: "categories-source",
  toolName: "get_spending_by_category",
  data: {
    categories: [
      { currency: "MXN", category: "Restaurantes", amount: "1700.00", percentage: "30.36", transactionCount: 3 },
      { currency: "MXN", category: "Transporte", amount: "700.00", percentage: "12.50", transactionCount: 2 },
    ],
    metadata: { queriedAt: "2026-09-12T00:00:00.000Z", startDate: "2026-08-01", endDate: "2026-08-31" },
  },
};

const transactions: UiDataSource = {
  id: "transactions-source",
  toolName: "get_transactions",
  data: {
    transactions: [{ id: transactionId, accountId, type: "expense", amount: "560.00", currency: "MXN", description: "Restaurante", category: "Restaurantes", transactionDate: "2026-08-08" }],
    pagination: { limit: 25, offset: 0, returned: 1, hasMore: false },
    metadata: { queriedAt: "2026-09-12T00:00:00.000Z", appliedFilters: { startDate: "2026-08-01", endDate: "2026-08-31" } },
  },
};

const anomalies: UiDataSource = {
  id: "anomalies-source",
  toolName: "detect_transaction_anomalies",
  data: {
    anomalies: [{ transactionId, amount: "560.00", currency: "MXN", category: "Restaurantes", transactionType: "expense", transactionDate: "2026-08-08", expectedRange: { lower: "100.00", upper: "400.00" }, anomalyScore: "1.2200", classification: "statistical_anomaly", reason: "amount_above_expected_range" }],
    metadata: { queriedAt: "2026-09-12T00:00:00.000Z", startDate: "2026-08-01", endDate: "2026-08-31", filters: {}, evaluatedTransactions: 8, eligibleGroups: 1, method: "iqr", minSampleSize: 4 },
  },
};

function change(previousValue: string, currentValue: string) {
  return { previousValue, currentValue, absoluteChange: (Number(currentValue) - Number(previousValue)).toFixed(2), percentageChange: "10.00", trend: "increased" as const };
}

test("BP3 recupera cinco composiciones personales enlazadas a fuentes MCP", () => {
  const cases: Array<{ query: string; sources: UiDataSource[]; rootId: string }> = [
    { query: "Muéstrame mis cuentas y saldos", sources: [accounts], rootId: "accounts-summary" },
    { query: "¿Por qué cambiaron mis gastos de julio a agosto de 2026?", sources: [comparison], rootId: "period-comparison" },
    { query: "Muéstrame mis gastos por categoría de agosto de 2026", sources: [categories], rootId: "spending-by-category" },
    { query: "Muéstrame los movimientos que explican ese cambio", sources: [comparison, transactions], rootId: "transactions-explorer" },
    { query: "Muéstrame anomalías de agosto de 2026", sources: [anomalies], rootId: "anomalies-review" },
  ];

  for (const item of cases) {
    const fallback = createIntentAwareUiFallback(item.query, item.sources, "personal_banking");
    assert.ok(fallback, item.query);
    assert.equal(fallback.root.id, item.rootId, item.query);
    assert.doesNotThrow(() => parseUiDocument(fallback, item.sources), item.query);
    assert.deepEqual(validateUiSemantics(item.query, fallback, item.sources), { success: true, issues: [] }, item.query);
  }
});

test("BP3 devuelve cuentas útiles desde el primer fallo del planner", async () => {
  let fetchCalls = 0;
  const generator = new GeminiUiGenerator({
    apiUrl: "https://generativelanguage.googleapis.com", apiKey: "test-key", model: "test-model", timeoutMs: 1_000,
  }, async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, "personal_banking");

  const document = await generator.generate({ query: "Muéstrame mis cuentas y saldos", answer: "Tienes una cuenta disponible.", dataSources: [accounts] });

  assert.equal(fetchCalls, 1);
  assert.equal(document.root.id, "accounts-summary");
  assert.doesNotThrow(() => parseUiDocument(document, [accounts]));
});

test("BP3 rechaza composiciones técnicas que no expresan el propósito bancario", () => {
  const bareAccounts = parseUiDocument({ version: "1.0", root: {
    id: "bare-accounts", type: "table", title: "Cuentas", data: { sourceId: accounts.id, path: "accounts" },
    columns: [{ key: "name", label: "Cuenta" }, { key: "balance", label: "Saldo" }], maxRows: 10,
  } }, [accounts]);
  const bareComparison = parseUiDocument({ version: "1.0", root: {
    id: "bare-comparison", type: "table", title: "Comparación", data: { sourceId: comparison.id, path: "comparisons.0.categories" },
    columns: [{ key: "category", label: "Categoría" }], maxRows: 10,
  } }, [comparison]);

  const options = { enforcePersonalBankingComposition: true };
  const accountsResult = validateUiSemantics("Muéstrame mis cuentas y saldos", bareAccounts, [accounts], options);
  const comparisonResult = validateUiSemantics("¿Por qué cambiaron mis gastos de julio a agosto de 2026?", bareComparison, [comparison], options);
  assert.equal(accountsResult.success, false);
  assert.equal(comparisonResult.success, false);
  if (!accountsResult.success) assert.ok(accountsResult.issues.some((issue) => issue.code === "personal_accounts_composition_required"));
  if (!comparisonResult.success) assert.ok(comparisonResult.issues.some((issue) => issue.code === "personal_comparison_composition_required"));
});

test("BP3 conserva todas las categorías, ordena por impacto y filtra sólo las solicitadas", () => {
  const source: UiDataSource = {
    id: "source-1", toolName: "compare_periods", data: {
      comparisons: [{
        currency: "MXN",
        income: change("30000.00", "30000.00"),
        expenses: change("20650.00", "27600.00"),
        netCashFlow: change("9350.00", "2400.00"),
        savingsRate: change("31.17", "8.00"),
        categories: [
          { category: "housing", change: change("8500.00", "8500.00") },
          { category: "entertainment", change: change("1200.00", "6400.00") },
          { category: "restaurants", change: change("3500.00", "5250.00") },
        ],
      }],
      metadata: {
        queriedAt: "2026-09-12T00:00:00.000Z",
        previousPeriod: { startDate: "2026-07-01", endDate: "2026-07-31" },
        currentPeriod: { startDate: "2026-08-01", endDate: "2026-08-31" },
      },
    },
  };
  const initialQuery = "¿Cómo cambiaron mis gastos entre julio y agosto de 2026?";
  const allSources = shapeFinancialDataForIntent({
    query: initialQuery, currentDate: "2026-09-12", dataSources: [source], experienceScope: "personal_banking",
  });
  const allView = allSources.find((candidate) => candidate.toolName === COMPARISON_CATEGORY_VIEW_SOURCE);
  assert.ok(allView);
  assert.deepEqual((allView.data as { categories: Array<{ category: string }> }).categories.map((row) => row.category),
    ["entertainment", "restaurants", "housing"]);
  const initialUi = createIntentAwareUiFallback(initialQuery, allSources, "personal_banking");
  assert.ok(initialUi && "children" in initialUi.root);
  assert.doesNotThrow(() => parseUiDocument(initialUi, allSources));
  assert.deepEqual(validateUiSemantics(initialQuery, initialUi, allSources, { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });
  const chartless = parseUiDocument({ ...initialUi, root: {
    ...initialUi.root, children: initialUi.root.children.filter((node) => node.type !== "chart"),
  } }, allSources);
  const chartlessResult = validateUiSemantics(initialQuery, chartless, allSources, { enforcePersonalBankingComposition: true });
  assert.equal(chartlessResult.success, false);
  if (!chartlessResult.success) assert.ok(chartlessResult.issues.some((issue) => issue.code === "personal_comparison_exploration_required"));
  const initialTable = initialUi.root.children.find((node) => node.type === "table");
  assert.equal(initialTable?.type, "table");
  if (initialTable?.type === "table") assert.equal(initialTable.maxRows, 3);
  assert.ok(initialUi.root.children.some((node) => node.type === "chart"));
  const adapted = adaptUiPayload(initialUi, allSources);
  const adaptedRoot = adapted.specification.root;
  assert.ok("children" in adaptedRoot);
  const adaptedTable = adaptedRoot.children.find((node) => node.type === "table");
  assert.equal(adaptedTable?.type, "table");
  if (adaptedTable?.type === "table") {
    assert.equal(adaptedTable.filtering?.enabled, true);
    assert.equal(adaptedTable.sorting?.enabled, true);
  }
  const chartRows = adapted.dataRegistry.data.source_2_comparison_category_chart;
  assert.ok(Array.isArray(chartRows));
  assert.deepEqual(chartRows.slice(0, 4).map((row: { category: string }) => row.category),
    ["Entretenimiento", "Entretenimiento", "Restaurantes", "Restaurantes"]);

  const filterQuery = "En este análisis de mis gastos, filtra la tabla para dejar únicamente entretenimiento y restaurantes.";
  const filteredSources = shapeFinancialDataForIntent({
    query: filterQuery, currentDate: "2026-09-12", dataSources: [source], experienceScope: "personal_banking",
  });
  const filteredView = filteredSources.find((candidate) => candidate.toolName === COMPARISON_CATEGORY_VIEW_SOURCE);
  assert.ok(filteredView);
  assert.deepEqual((filteredView.data as { categories: Array<{ category: string }> }).categories.map((row) => row.category),
    ["entertainment", "restaurants"]);
  const filteredUi = createIntentAwareUiFallback(filterQuery, filteredSources, "personal_banking");
  assert.ok(filteredUi && "children" in filteredUi.root);
  const filteredTable = filteredUi.root.children.find((node) => node.type === "table");
  assert.equal(filteredTable?.type, "table");
  if (filteredTable?.type === "table") {
    const rows = resolveUiDataReference(filteredTable.data, filteredSources);
    assert.ok(Array.isArray(rows));
    assert.deepEqual(rows.map((row: { category: string }) => row.category), ["entertainment", "restaurants"]);
  }
  assert.deepEqual(validateUiSemantics(filterQuery, filteredUi, filteredSources, { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });

  const wrongUi = createIntentAwareUiFallback(filterQuery, [source], "personal_banking");
  assert.ok(wrongUi);
  const wrongResult = validateUiSemantics(filterQuery, wrongUi, [source], { enforcePersonalBankingComposition: true });
  assert.equal(wrongResult.success, false);
  if (!wrongResult.success) assert.ok(wrongResult.issues.some((issue) => issue.code === "personal_category_filter_mismatch"));
});
