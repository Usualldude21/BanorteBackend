import { type AuthenticatedUser } from "../application/authenticated-user.js";
import {
  type AccountReader,
  type AnalyticsReader,
} from "../application/ports/financial-data.js";
import { compareDecimal } from "../domain/decimal.js";
import {
  EvaluateFinancialHealthOutputSchema,
  type EvaluateFinancialHealthInput,
  type EvaluateFinancialHealthOutput,
  type FinancialHealthAssessment,
} from "../schemas/financial-health.schema.js";

const FORMULAS_VERSION = "1.0" as const;

export class FinancialHealthService {
  constructor(
    private readonly analytics: AnalyticsReader,
    private readonly accounts: AccountReader,
    private readonly user: AuthenticatedUser,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluate(input: EvaluateFinancialHealthInput): Promise<EvaluateFinancialHealthOutput> {
    const period = { ...input, userId: this.user.id };
    const calculatedAt = this.now().toISOString();
    const [accounts, summaries, categories, cashflow] = await Promise.all([
      this.accounts.obtenerPorUsuario({ user_id: this.user.id, status: "active", currency: input.currency }),
      this.analytics.obtenerResumen(period),
      this.analytics.obtenerGastoPorCategoria(period),
      this.analytics.obtenerCashflow({ ...period, granularity: "month" }),
    ]);
    const currencies = new Set([
      ...(input.currency ? [input.currency] : []),
      ...accounts.map((account) => account.currency),
      ...summaries.map((summary) => summary.currency),
      ...categories.map((category) => category.currency),
      ...cashflow.map((row) => row.currency),
    ]);

    return EvaluateFinancialHealthOutputSchema.parse({
      dataType: "OBSERVED",
      health: [...currencies].sort().map((currency) => assessCurrency(
        currency,
        accounts.filter((account) => account.currency === currency),
        summaries.find((summary) => summary.currency === currency),
        categories.filter((category) => category.currency === currency),
        cashflow.filter((row) => row.currency === currency),
        calculatedAt,
      )),
      metadata: {
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.currency ? { currency: input.currency } : {}),
        calculatedAt,
        formulasVersion: FORMULAS_VERSION,
      },
    });
  }
}

type AccountRows = Awaited<ReturnType<AccountReader["obtenerPorUsuario"]>>;
type SummaryRow = Awaited<ReturnType<AnalyticsReader["obtenerResumen"]>>[number] | undefined;
type CategoryRows = Awaited<ReturnType<AnalyticsReader["obtenerGastoPorCategoria"]>>;
function assessCurrency(
  currency: string,
  accounts: AccountRows,
  summary: SummaryRow,
  categories: CategoryRows,
  cashflow: Awaited<ReturnType<AnalyticsReader["obtenerCashflow"]>>,
  evaluatedAt: string,
): FinancialHealthAssessment {
  const totalIncome = money(summary?.total_income ?? "0");
  const totalExpenses = money(summary?.total_expenses ?? "0");
  const netCashFlow = money(summary?.net_cash_flow ?? "0");
  const totalLiquidBalance = formatMoney(accounts
    .filter((account) => account.type === "checking" || account.type === "savings")
    .reduce((total, account) => total + parseMoney(account.balance), 0n));
  const sortedCashflow = [...cashflow].sort((left, right) => left.period_start.localeCompare(right.period_start));
  const topCategory = [...categories].sort((left, right) => (
    compareDecimal(right.amount, left.amount) || left.category.localeCompare(right.category)
  ))[0];
  const expenseRatio = ratioPercent(parseMoney(totalExpenses), parseMoney(totalIncome));
  const savingsRate = ratioPercent(parseMoney(netCashFlow), parseMoney(totalIncome));
  const averageMonthlyMargin = sortedCashflow.length === 0
    ? "0.00"
    : formatMoney(divideRoundHalfAway(parseMoney(netCashFlow), BigInt(sortedCashflow.length)));
  const stability = calculateStability(sortedCashflow.map((row) => parseMoney(row.net_cash_flow)));
  const concentration = ratioPercent(
    topCategory ? parseMoney(topCategory.amount) : 0n,
    parseMoney(totalExpenses),
  );
  const score = overallScore(savingsRate, stability.score, concentration, Boolean(summary));

  return {
    currency,
    score,
    status: !summary ? "insufficient_data" : score >= 70 ? "healthy" : score >= 40 ? "attention" : "critical",
    totalLiquidBalance,
    netCashFlow,
    savingsRate,
    evaluatedAt,
    observed: {
      totalIncome,
      totalExpenses,
      monthsObserved: sortedCashflow.length,
      topExpenseCategory: topCategory
        ? { category: topCategory.category, amount: money(topCategory.amount) }
        : null,
    },
    metrics: {
      expenseToIncomeRatio: expenseRatio,
      averageMonthlyMargin,
      cashflowStability: {
        score: stability.score,
        rating: stability.rating,
        method: "mean_absolute_deviation",
      },
      categoryConcentration: {
        percentage: concentration,
        category: topCategory?.category ?? null,
      },
    },
    trends: buildTrends(sortedCashflow),
  };
}

function calculateStability(values: bigint[]): {
  score: string | null;
  rating: "high" | "medium" | "low" | "insufficient_data";
} {
  if (values.length < 2) return { score: null, rating: "insufficient_data" };
  const count = BigInt(values.length);
  const mean = divideRoundHalfAway(values.reduce((sum, value) => sum + value, 0n), count);
  const deviation = divideRoundHalfAway(
    values.reduce((sum, value) => sum + absolute(value - mean), 0n),
    count,
  );
  const baseline = divideRoundHalfAway(
    values.reduce((sum, value) => sum + absolute(value), 0n),
    count,
  );
  const penalty = baseline === 0n ? 10_000n : minimum(10_000n, percentageBasisPoints(deviation, baseline));
  const scoreBasisPoints = 10_000n - penalty;
  return {
    score: formatPercentage(scoreBasisPoints),
    rating: scoreBasisPoints >= 7_500n ? "high" : scoreBasisPoints >= 5_000n ? "medium" : "low",
  };
}

function overallScore(
  savingsRate: string | null,
  stability: string | null,
  concentration: string | null,
  hasObservedSummary: boolean,
): number {
  if (!hasObservedSummary) return 0;
  const components = [
    savingsRate === null ? null : clampPercentageBasisPoints(parsePercentage(savingsRate)),
    stability === null ? null : clampPercentageBasisPoints(parsePercentage(stability)),
    concentration === null ? null : 10_000n - clampPercentageBasisPoints(parsePercentage(concentration)),
  ].filter((component): component is bigint => component !== null);
  if (components.length === 0) return 0;
  const average = divideRoundHalfAway(
    components.reduce((sum, component) => sum + component, 0n),
    BigInt(components.length),
  );
  return Number(divideRoundHalfAway(average, 100n));
}

function buildTrends(
  rows: Awaited<ReturnType<AnalyticsReader["obtenerCashflow"]>>,
): FinancialHealthAssessment["trends"] {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last || first.period_start === last.period_start) return [];
  return ([
    ["income", first.income, last.income],
    ["expenses", first.expenses, last.expenses],
    ["net_cash_flow", first.net_cash_flow, last.net_cash_flow],
  ] as const).map(([metric, previousRaw, currentRaw]) => {
    const previousValue = money(previousRaw);
    const currentValue = money(currentRaw);
    const comparison = compareDecimal(currentValue, previousValue);
    return {
      metric,
      fromPeriod: first.period_start,
      toPeriod: last.period_start,
      previousValue,
      currentValue,
      percentageChange: ratioPercent(
        parseMoney(currentValue) - parseMoney(previousValue),
        absolute(parseMoney(previousValue)),
      ),
      direction: parseMoney(previousValue) === 0n
        ? comparison === 0 ? "unchanged" as const : "no_baseline" as const
        : comparison > 0 ? "increased" as const : comparison < 0 ? "decreased" as const : "unchanged" as const,
    };
  });
}

function money(value: string): string {
  return formatMoney(parseMoney(value));
}

function parseMoney(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Importe financiero inválido");
  const fraction = match[3] ?? "";
  let units = BigInt(match[2]!) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (Number(fraction[2] ?? "0") >= 5) units += 1n;
  return match[1] === "-" ? -units : units;
}

function formatMoney(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const digits = absolute(value).toString().padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function ratioPercent(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  return formatPercentage(divideRoundHalfAway(numerator * 10_000n, absolute(denominator)));
}

function percentageBasisPoints(numerator: bigint, denominator: bigint): bigint {
  return divideRoundHalfAway(numerator * 10_000n, denominator);
}

function parsePercentage(value: string): bigint {
  return parseMoney(value);
}

function formatPercentage(basisPoints: bigint): string {
  return formatMoney(basisPoints);
}

function divideRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Divisor financiero inválido");
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = absolute(numerator);
  return sign * ((magnitude + denominator / 2n) / denominator);
}

function clampPercentageBasisPoints(value: bigint): bigint {
  return value < 0n ? 0n : value > 10_000n ? 10_000n : value;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
