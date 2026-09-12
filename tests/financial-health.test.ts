import assert from "node:assert/strict";
import test from "node:test";
import { type AccountReader, type AnalyticsReader } from "../src/application/ports/financial-data.js";
import { validateToolOutput } from "../src/agent/mcp-client/tool-output-validator.js";
import { isAllowedTool } from "../src/agent/tool-policy.js";
import { adaptUiDataSource } from "../src/integration/shared-contract-adapter.js";
import { FinancialHealthService } from "../src/services/financial-health.service.js";

const userId = "10000000-0000-4000-8000-000000000001";

test("calcula la salud financiera de forma determinística", async () => {
  const accounts: AccountReader = {
    obtenerPorUsuario: async () => [
      account("checking", "10000.00", "10000000-0000-4000-8000-000000000010"),
      account("savings", "5000.00", "10000000-0000-4000-8000-000000000011"),
      account("credit_card", "3000.00", "10000000-0000-4000-8000-000000000012"),
    ],
  };
  const analytics: AnalyticsReader = {
    obtenerResumen: async () => [{
      currency: "MXN", total_income: "30000.0000", total_expenses: "24000.0000",
      net_cash_flow: "6000.0000", savings_rate: "20.00", transaction_count: 9,
      largest_expense: "12000.00", largest_income: "10000.00",
    }],
    obtenerGastoPorCategoria: async () => [
      { currency: "MXN", category: "housing", amount: "12000.00", percentage: "50.00", transaction_count: 3 },
      { currency: "MXN", category: "food", amount: "6000.00", percentage: "25.00", transaction_count: 3 },
    ],
    obtenerCashflow: async () => [
      cashflow("2026-01-01", "10000.00", "8000.00", "2000.00"),
      cashflow("2026-02-01", "10000.00", "9000.00", "1000.00"),
      cashflow("2026-03-01", "10000.00", "7000.00", "3000.00"),
    ],
  };
  const service = new FinancialHealthService(
    analytics,
    accounts,
    { id: userId },
    () => new Date("2026-04-01T12:00:00.000Z"),
  );

  const result = await service.evaluate({ startDate: "2026-01-01", endDate: "2026-03-31", currency: "MXN" });

  assert.equal(result.dataType, "OBSERVED");
  assert.equal(result.metadata.calculatedAt, "2026-04-01T12:00:00.000Z");
  assert.deepEqual(result.health[0], {
    currency: "MXN",
    score: 46,
    status: "attention",
    totalLiquidBalance: "15000.00",
    netCashFlow: "6000.00",
    savingsRate: "20.00",
    evaluatedAt: "2026-04-01T12:00:00.000Z",
    observed: {
      totalIncome: "30000.00",
      totalExpenses: "24000.00",
      monthsObserved: 3,
      topExpenseCategory: { category: "housing", amount: "12000.00" },
    },
    metrics: {
      expenseToIncomeRatio: "80.00",
      averageMonthlyMargin: "2000.00",
      cashflowStability: { score: "66.67", rating: "medium", method: "mean_absolute_deviation" },
      categoryConcentration: { percentage: "50.00", category: "housing" },
    },
    trends: [
      { metric: "income", fromPeriod: "2026-01-01", toPeriod: "2026-03-01", previousValue: "10000.00", currentValue: "10000.00", percentageChange: "0.00", direction: "unchanged" },
      { metric: "expenses", fromPeriod: "2026-01-01", toPeriod: "2026-03-01", previousValue: "8000.00", currentValue: "7000.00", percentageChange: "-12.50", direction: "decreased" },
      { metric: "net_cash_flow", fromPeriod: "2026-01-01", toPeriod: "2026-03-01", previousValue: "2000.00", currentValue: "3000.00", percentageChange: "50.00", direction: "increased" },
    ],
  });
  assert.equal(isAllowedTool("evaluate_financial_health"), true);
  assert.deepEqual(validateToolOutput("evaluate_financial_health", result), result);
  const adapted = adaptUiDataSource({
    id: "source-1",
    toolName: "evaluate_financial_health",
    data: result,
  }).value as { dataType: string; health: Array<{ score: number }> };
  assert.equal(adapted.dataType, "OBSERVED");
  assert.equal(adapted.health[0]?.score, 0.46);
});

test("devuelve datos insuficientes para una moneda solicitada sin movimientos", async () => {
  const analytics: AnalyticsReader = {
    obtenerResumen: async () => [],
    obtenerGastoPorCategoria: async () => [],
    obtenerCashflow: async () => [],
  };
  const accounts: AccountReader = { obtenerPorUsuario: async () => [] };
  const service = new FinancialHealthService(analytics, accounts, { id: userId });

  const result = await service.evaluate({
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    currency: "MXN",
  });

  assert.equal(result.health.length, 1);
  assert.equal(result.health[0]?.currency, "MXN");
  assert.equal(result.health[0]?.status, "insufficient_data");
});

function account(type: "checking" | "savings" | "credit_card", balance: string, id: string) {
  return {
    id, user_id: userId, type, status: "active" as const, name: type, currency: "MXN",
    balance, masked_identifier: "****1234", created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function cashflow(period_start: string, income: string, expenses: string, net_cash_flow: string) {
  return { period_start, currency: "MXN", income, expenses, net_cash_flow, transaction_count: 3 };
}
