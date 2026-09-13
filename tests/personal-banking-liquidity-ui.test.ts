import assert from "node:assert/strict";
import test from "node:test";
import { LIQUIDITY_ANALYSIS_SOURCE, shapeFinancialDataForIntent } from "../src/agent/reasoning/financial-intent-data-shaper.js";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { createIntentAwareUiFallback } from "../src/ui/generation/intent-aware-ui-fallback.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const accountId = "20000000-0000-4000-8000-000000000001";
const period = { startDate: "2026-08-10", endDate: "2026-08-20" };
const queriedAt = "2026-09-12T00:00:00.000Z";
const cashflow: UiDataSource = {
  id: "source-1", toolName: "get_cashflow", data: {
    granularity: "day",
    periods: [
      day("2026-08-10", "0.00", "900.00", "-900.00"),
      day("2026-08-11", "0.00", "400.00", "-400.00"),
      day("2026-08-12", "0.00", "750.00", "-750.00"),
      day("2026-08-15", "15000.00", "0.00", "15000.00"),
    ],
    metadata: { queriedAt, ...period, currency: "MXN" },
  },
};
const transactions: UiDataSource = {
  id: "source-2", toolName: "get_transactions", data: {
    transactions: [
      movement("50000000-0000-4000-8000-000000000010", "2026-08-10", "expense", "900.00", "groceries"),
      movement("50000000-0000-4000-8000-000000000011", "2026-08-11", "expense", "400.00", "transport"),
      movement("50000000-0000-4000-8000-000000000012", "2026-08-12", "expense", "750.00", "restaurants"),
      movement("50000000-0000-4000-8000-000000000015", "2026-08-15", "income", "15000.00", "income"),
    ],
    pagination: { limit: 100, offset: 0, returned: 4, hasMore: false },
    metadata: { queriedAt, appliedFilters: period },
  },
};

function day(periodStart: string, income: string, expenses: string, netCashFlow: string) {
  return { periodStart, currency: "MXN", income, expenses, netCashFlow, transactionCount: 1 };
}

function movement(id: string, transactionDate: string, type: "income" | "expense", amount: string, category: string) {
  return { id, accountId, type, amount, currency: "MXN", description: category, category, transactionDate };
}

test("BP3 conserva todos los movimientos del rango además de los gastos previos", () => {
  const query = "En mis movimientos y liquidez, enfoca los gastos que precedieron el mínimo y filtra la tabla de movimientos del 10 al 20 de agosto de 2026.";
  const sources = shapeFinancialDataForIntent({
    query, currentDate: "2026-09-12", dataSources: [cashflow, transactions], experienceScope: "personal_banking",
  });
  const derived = sources.find((source) => source.toolName === LIQUIDITY_ANALYSIS_SOURCE);
  assert.ok(derived);
  const derivedData = derived.data as { transactions: unknown[]; precedingExpenses: unknown[] };
  assert.equal(derivedData.transactions.length, 4);
  assert.equal(derivedData.precedingExpenses.length, 3);

  const ui = createIntentAwareUiFallback(query, sources, "personal_banking");
  assert.ok(ui && ui.root.type === "tabs");
  assert.doesNotThrow(() => parseUiDocument(ui, sources));
  assert.equal(ui.root.tabs.length, 3);
  const movementTab = ui.root.tabs.find((tab) => tab.id === "liquidity-transactions");
  const movementTable = movementTab?.children.find((node) => node.type === "table");
  assert.equal(movementTable?.type, "table");
  if (movementTable?.type === "table") {
    assert.equal(movementTable.data.sourceId, derived.id);
    assert.equal(movementTable.data.path, "transactions");
    assert.equal(movementTable.maxRows, 4);
  }
  assert.deepEqual(validateUiSemantics(query, ui, sources, { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });

  const incomplete = { ...ui, root: { ...ui.root, tabs: ui.root.tabs.filter((tab) => tab.id !== "liquidity-transactions") } };
  const result = validateUiSemantics(query, incomplete, sources, { enforcePersonalBankingComposition: true });
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some((issue) => issue.code === "liquidity_transactions_table_incomplete"));
});
