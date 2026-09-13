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
    { query: "Muéstrame los movimientos que explican ese cambio", sources: [comparison, transactions], rootId: "comparison-with-transactions" },
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

test("GEN3 usa respaldo de cuentas sólo después de agotar las reparaciones", async () => {
  let fetchCalls = 0;
  const generator = new GeminiUiGenerator({
    apiUrl: "https://generativelanguage.googleapis.com", apiKey: "test-key", model: "test-model", timeoutMs: 1_000,
  }, async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, "personal_banking");

  const document = await generator.generate({ query: "Muéstrame mis cuentas y saldos", answer: "Tienes una cuenta disponible.", dataSources: [accounts] });

  assert.equal(fetchCalls, 3);
  assert.equal(document.root.id, "accounts-summary");
  assert.doesNotThrow(() => parseUiDocument(document, [accounts]));
});

test("GEN3 permite composiciones libres con datos válidos", () => {
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
  assert.deepEqual(accountsResult, { success: true, issues: [] });
  assert.deepEqual(comparisonResult, { success: true, issues: [] });
});

test("GEN3 aplica restricciones visuales sólo de la última solicitud", () => {
  const table = parseUiDocument({ version: "1.0", root: {
    id: "only-current-table", type: "table", title: "Cuentas",
    data: { sourceId: accounts.id, path: "accounts" },
    columns: [{ key: "name", label: "Cuenta" }, { key: "balance", label: "Saldo" }], maxRows: 10,
  } }, [accounts]);
  const context = "Contexto previo: el usuario pidió una gráfica y prohibió tablas. Nueva solicitud del usuario: Muéstrame ahora los saldos en una tabla.";
  assert.deepEqual(validateUiSemantics(context, table, [accounts], { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });
});

test("GEN3 repara una salida inválida antes de recurrir al respaldo", async () => {
  const generated = { version: "1.0", root: {
    id: "planner-table", type: "table", title: "Cuentas observadas",
    data: { sourceId: accounts.id, path: "accounts" },
    columns: [{ key: "name", label: "Cuenta" }, { key: "balance", label: "Saldo" }], maxRows: 10,
  } };
  let calls = 0;
  const generator = new GeminiUiGenerator({
    apiUrl: "https://generativelanguage.googleapis.com", apiKey: "test-key", model: "test-model", timeoutMs: 1_000,
  }, async () => {
    calls += 1;
    const text = calls === 1 ? "{}" : JSON.stringify(generated);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }, "personal_banking");
  const result = await generator.generate({ query: "¿Qué cuentas tengo disponibles?", answer: "Una cuenta disponible.", dataSources: [accounts] });
  assert.equal(calls, 2);
  assert.equal(result.root.id, "planner-table");
});

test("GEN3 repara en sitio la divulgación de muestra insuficiente sin reemplazar la UI", async () => {
  const source: UiDataSource = { ...anomalies, data: {
    anomalies: [], metadata: { queriedAt: "2026-09-12T00:00:00.000Z", startDate: "2026-08-01", endDate: "2026-08-31",
      filters: {}, evaluatedTransactions: 26, eligibleGroups: 0, method: "iqr", minSampleSize: 8 },
  } };
  let calls = 0;
  const generated = { version: "1.0", root: { id: "planner-signal", type: "metric", label: "Movimientos evaluados",
    value: { sourceId: source.id, path: "metadata.evaluatedTransactions" }, format: "number" } };
  const generator = new GeminiUiGenerator({ apiUrl: "https://generativelanguage.googleapis.com", apiKey: "test-key",
    model: "test-model", timeoutMs: 1_000 }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }, "personal_banking");
  const result = await generator.generate({ query: "¿Hay movimientos inusuales en agosto?",
    answer: "La muestra no alcanza para evaluar anomalías.", dataSources: [source] });
  assert.equal(calls, 1);
  assert.equal(result.root.type, "stack");
  if (result.root.type === "stack") {
    assert.ok(result.root.children.some((node) => node.id === "planner-signal"));
    assert.ok(result.root.children.some((node) => node.type === "alert" && /Muestra insuficiente/u.test(node.text)));
  }
});

test("GEN3 rechaza la contradicción exacta de la captura y conserva la vista generada al repararla", async () => {
  const source: UiDataSource = { ...anomalies, data: {
    anomalies: [], metadata: { queriedAt: "2026-09-12T00:00:00.000Z", startDate: "2026-08-01", endDate: "2026-08-31",
      filters: {}, evaluatedTransactions: 26, eligibleGroups: 0, method: "iqr", minSampleSize: 8 },
  } };
  const generated = { version: "1.0", root: { id: "planner-patterns", type: "stack", direction: "vertical", children: [
    { id: "correct-warning", type: "alert", severity: "info", text: "Muestra insuficiente para evaluar anomalías estadísticas." },
    { id: "contradictory-warning", type: "alert", severity: "info", text: "No se identificaron importes inusuales. La solidez de la señal no es concluyente." },
    { id: "evaluated-count", type: "metric", label: "Transacciones analizadas",
      value: { sourceId: source.id, path: "metadata.evaluatedTransactions" }, format: "number" },
  ] } };
  const parsed = parseUiDocument(generated, [source]);
  const request = "Al revisar mis movimientos de agosto de 2026, ¿hay algo fuera de lo habitual que merezca atención?";
  const before = validateUiSemantics(request, parsed, [source], { enforcePersonalBankingComposition: true });
  assert.equal(before.success, false);
  if (!before.success) assert.ok(before.issues.some((issue) => issue.code === "personal_anomaly_sample_disclosure_required"));

  let calls = 0;
  const generator = new GeminiUiGenerator({ apiUrl: "https://generativelanguage.googleapis.com", apiKey: "test-key",
    model: "test-model", timeoutMs: 1_000 }, async () => {
    calls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }, "personal_banking");
  const result = await generator.generate({ query: request, answer: "La muestra no alcanza para evaluar anomalías.", dataSources: [source] });
  assert.equal(calls, 1);
  assert.equal(result.root.id, "planner-patterns");
  assert.equal(result.root.type, "stack");
  if (result.root.type === "stack") {
    assert.ok(result.root.children.some((node) => node.id === "evaluated-count"));
    assert.ok(!result.root.children.some((node) => (node.type === "alert" || node.type === "text")
      && /No se identificaron importes inusuales/u.test(node.text)));
  }
  assert.deepEqual(validateUiSemantics(request, result, [source], { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });
});

test("GEN3 elige el respaldo por intención aunque existan fuentes adicionales", () => {
  const sources = [anomalies, accounts, categories, comparison, transactions];
  const cases = [
    ["¿Dónde se concentra el gasto del mes?", "spending-by-category"],
    ["¿Cómo evolucionaron mis gastos entre los dos meses?", "period-comparison"],
    ["¿Qué comercios aparecen con más frecuencia?", "merchant-concepts"],
    ["¿Hay movimientos inusuales que deba revisar?", "anomalies-review"],
  ] as const;
  for (const [query, expected] of cases) {
    assert.equal(createIntentAwareUiFallback(query, sources, "personal_banking")?.root.id, expected, query);
  }
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
  assert.deepEqual(chartlessResult, { success: true, issues: [] });
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

  const entertainmentTransactions: UiDataSource = {
    id: "source-entertainment", toolName: "get_transactions", data: {
      transactions: [{ transactionDate: "2026-08-24", description: "Compra especial", category: "entertainment", amount: "6000.00", currency: "MXN" }],
    },
  };
  const restaurantTransactions: UiDataSource = {
    id: "source-restaurants", toolName: "get_transactions", data: {
      transactions: [{ transactionDate: "2026-08-18", description: "Restaurante", category: "restaurants", amount: "750.00", currency: "MXN" }],
    },
  };
  const detailSources = [...filteredSources, entertainmentTransactions, restaurantTransactions];
  const transactionTable = (id: string, sourceId: string) => ({
    id, type: "table" as const, title: "Movimientos individuales",
    data: { sourceId, path: "transactions" },
    columns: [
      { key: "transactionDate", label: "Fecha" },
      { key: "description", label: "Concepto" },
      { key: "category", label: "Categoría" },
      { key: "amount", label: "Monto" },
    ],
    maxRows: 10,
  });
  const detailUi = parseUiDocument({ version: "1.0", root: {
    ...filteredUi.root,
    children: [
      ...filteredUi.root.children,
      transactionTable("entertainment-movements", entertainmentTransactions.id),
      transactionTable("restaurant-movements", restaurantTransactions.id),
    ],
  } }, detailSources);
  assert.deepEqual(validateUiSemantics(filterQuery, detailUi, detailSources, { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });

  const incompleteDetailUi = parseUiDocument({ version: "1.0", root: {
    ...filteredUi.root,
    children: [...filteredUi.root.children, transactionTable("only-entertainment", entertainmentTransactions.id)],
  } }, detailSources);
  const incompleteDetailResult = validateUiSemantics(filterQuery, incompleteDetailUi, detailSources,
    { enforcePersonalBankingComposition: true });
  assert.equal(incompleteDetailResult.success, false);
  if (!incompleteDetailResult.success) {
    assert.ok(incompleteDetailResult.issues.some((issue) => issue.code === "personal_category_filter_mismatch"));
  }

  const wrongUi = createIntentAwareUiFallback(filterQuery, [source], "personal_banking");
  assert.ok(wrongUi);
  const wrongResult = validateUiSemantics(filterQuery, wrongUi, [source], { enforcePersonalBankingComposition: true });
  assert.equal(wrongResult.success, false);
  if (!wrongResult.success) assert.ok(wrongResult.issues.some((issue) => issue.code === "personal_category_filter_mismatch"));
});
