import { addDecimal, compareDecimal } from "../../domain/decimal.js";
import { CashflowOutputSchema } from "../../schemas/analytics.schema.js";
import { ComparePeriodsOutputSchema } from "../../schemas/compare-periods.schema.js";
import {
  GetTransactionsOutputSchema,
  type GetTransactionsOutput,
} from "../../schemas/get-transactions.schema.js";
import { type UiDataSource } from "../../ui/dsl/ui.schema.js";
import type { FinancialExperienceScope } from "../security/financial-scope-policy.js";
import { categoryIdentity, selectedComparisonCategories } from "./personal-category-selection.js";

const PRECEDING_EXPENSE_WINDOW_DAYS = 7;
export const LIQUIDITY_ANALYSIS_SOURCE = "derived_liquidity_analysis";
export const COMPARISON_CATEGORY_VIEW_SOURCE = "derived_comparison_category_view";

interface ShapeFinancialDataInput {
  query: string;
  currentDate: string;
  dataSources: readonly UiDataSource[];
  experienceScope?: FinancialExperienceScope;
}

export function shapeFinancialDataForIntent(
  input: ShapeFinancialDataInput,
): UiDataSource[] {
  const sources = [...input.dataSources];
  if (input.experienceScope === "personal_banking") {
    const categoryView = createComparisonCategoryView(input.query, sources);
    if (categoryView) sources.push(categoryView);
  }
  if (!requiresLiquidityPrecursorAnalysis(input.query)) return sources;

  const cashflow = findDailyCashflow(sources);
  if (!cashflow) return sources;
  const endDate = earlierDate(cashflow.metadata.endDate, input.currentDate);
  const transactions = collectCompleteTransactions(
    sources,
    cashflow.metadata.startDate,
    endDate,
  );
  if (!transactions) return sources;

  const periods = cashflow.periods
    .filter((period) => period.periodStart >= cashflow.metadata.startDate && period.periodStart <= endDate)
    .sort((left, right) => (
      left.periodStart.localeCompare(right.periodStart)
      || left.currency.localeCompare(right.currency)
    ));
  if (periods.length === 0) return sources;

  const monthlyGroups = groupPeriodsByMonthAndCurrency(periods);
  const timeline = [];
  const monthlyLows = [];
  const precedingExpenses = [];

  for (const monthPeriods of monthlyGroups.values()) {
    const firstPeriod = monthPeriods[0];
    if (!firstPeriod) continue;
    const month = firstPeriod.periodStart.slice(0, 7);
    const currency = firstPeriod.currency;
    let relativeLiquidity = "0";
    const monthTimeline = monthPeriods.map((period) => {
      relativeLiquidity = addDecimal(relativeLiquidity, period.netCashFlow);
      return {
        date: period.periodStart,
        dayOfMonth: Number(period.periodStart.slice(8, 10)),
        month,
        income: period.income,
        expenses: period.expenses,
        netCashFlow: period.netCashFlow,
        relativeLiquidity,
        currency: period.currency,
      };
    });
    timeline.push(...monthTimeline);

    const low = monthTimeline.reduce((currentLow, point) => (
      compareDecimal(point.relativeLiquidity, currentLow.relativeLiquidity) < 0 ? point : currentLow
    ));
    const windowStart = shiftIsoDate(low.date, -PRECEDING_EXPENSE_WINDOW_DAYS);
    const expenses = transactions.filter((transaction) => (
      transaction.type === "expense"
      && transaction.currency === currency
      && transaction.transactionDate >= windowStart
      && transaction.transactionDate <= low.date
    ));
    const precedingExpenseTotal = expenses.reduce(
      (total, transaction) => addDecimal(total, transaction.amount),
      "0",
    );

    monthlyLows.push({
      month,
      lowDate: low.date,
      dayOfMonth: low.dayOfMonth,
      relativeLiquidity: low.relativeLiquidity,
      precedingExpenseTotal,
      precedingExpenseCount: expenses.length,
      currency: low.currency,
    });
    precedingExpenses.push(...expenses.map((transaction) => ({
      month,
      lowDate: low.date,
      transactionDate: transaction.transactionDate,
      daysBeforeLow: daysBetween(transaction.transactionDate, low.date),
      category: transaction.category,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.currency,
    })));
  }

  return [...sources, {
    id: `source-${nextSourceNumber(sources)}`,
    toolName: LIQUIDITY_ANALYSIS_SOURCE,
    data: {
      timeline,
      monthlyLows,
      precedingExpenses,
      transactions,
      metadata: {
        startDate: cashflow.metadata.startDate,
        endDate,
        precedingWindowDays: PRECEDING_EXPENSE_WINDOW_DAYS,
        liquidityBasis: "cumulative_net_cashflow_within_month",
        transactionCoverage: "complete",
      },
    },
  }];
}

function createComparisonCategoryView(query: string, sources: readonly UiDataSource[]): UiDataSource | undefined {
  const comparisonSource = [...sources].reverse().find((source) => source.toolName === "compare_periods");
  if (!comparisonSource) return undefined;
  const parsed = ComparePeriodsOutputSchema.safeParse(comparisonSource.data);
  if (!parsed.success || parsed.data.comparisons.length !== 1) return undefined;
  const comparison = parsed.data.comparisons[0]!;
  const selected = selectedComparisonCategories(query, comparison.categories.map((row) => row.category));
  const categories = comparison.categories
    .filter((row) => !selected || selected.includes(categoryIdentity(row.category)))
    .sort((left, right) => {
      const leftImpact = left.change.absoluteChange.replace(/^-/, "");
      const rightImpact = right.change.absoluteChange.replace(/^-/, "");
      return compareDecimal(rightImpact, leftImpact) || left.category.localeCompare(right.category);
    })
    .map((row) => ({
      category: row.category,
      currency: comparison.currency,
      previousValue: row.change.previousValue,
      currentValue: row.change.currentValue,
      absoluteChange: row.change.absoluteChange,
      percentageChange: row.change.percentageChange,
    }));
  if (categories.length === 0) return undefined;
  return {
    id: `source-${nextSourceNumber(sources)}`,
    toolName: COMPARISON_CATEGORY_VIEW_SOURCE,
    data: {
      categories,
      metadata: {
        previousPeriod: parsed.data.metadata.previousPeriod,
        currentPeriod: parsed.data.metadata.currentPeriod,
        currency: comparison.currency,
        ...(selected ? { selectedCategories: selected } : {}),
      },
    },
  };
}

export function requiresLiquidityPrecursorAnalysis(query: string): boolean {
  const normalized = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");
  return /\bliquidez\b/u.test(normalized)
    && /\b(?:antes|previos?|preceden|precedieron|precedentes|justo antes|drenan|causan?)\b/u.test(normalized);
}

function findDailyCashflow(sources: readonly UiDataSource[]) {
  for (const source of [...sources].reverse()) {
    if (source.toolName !== "get_cashflow") continue;
    const result = CashflowOutputSchema.safeParse(source.data);
    if (result.success && result.data.granularity === "day") return result.data;
  }
  return undefined;
}

function groupPeriodsByMonthAndCurrency(
  periods: Array<ReturnType<typeof CashflowOutputSchema.parse>["periods"][number]>,
) {
  const groups = new Map<string, typeof periods>();
  for (const period of periods) {
    const month = period.periodStart.slice(0, 7);
    const key = JSON.stringify([month, period.currency]);
    const group = groups.get(key) ?? [];
    group.push(period);
    groups.set(key, group);
  }
  return groups;
}

function collectCompleteTransactions(
  sources: readonly UiDataSource[],
  startDate: string,
  endDate: string,
): GetTransactionsOutput["transactions"] | undefined {
  const pages = sources.flatMap((source) => {
    if (source.toolName !== "get_transactions") return [];
    const result = GetTransactionsOutputSchema.safeParse(source.data);
    if (!result.success) return [];
    const filters = result.data.metadata.appliedFilters;
    return filters.startDate === startDate && filters.endDate === endDate ? [result.data] : [];
  }).sort((left, right) => left.pagination.offset - right.pagination.offset);

  let expectedOffset = 0;
  const transactions = new Map<string, GetTransactionsOutput["transactions"][number]>();
  for (const page of pages) {
    if (page.pagination.offset !== expectedOffset) return undefined;
    for (const transaction of page.transactions) transactions.set(transaction.id, transaction);
    expectedOffset += page.pagination.returned;
    if (!page.pagination.hasMore) {
      return [...transactions.values()]
        .filter((transaction) => transaction.transactionDate >= startDate && transaction.transactionDate <= endDate)
        .sort((left, right) => left.transactionDate.localeCompare(right.transactionDate));
    }
  }
  return undefined;
}

function nextSourceNumber(sources: readonly UiDataSource[]): number {
  return sources.reduce((highest, source) => {
    const match = /^source-(\d+)$/u.exec(source.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

function earlierDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  );
}
