import { compareDecimal, percentageChange, subtractDecimal } from "../domain/decimal.js";
import { type AnalyticsReader } from "../application/ports/financial-data.js";
import { type ComparePeriodsInput, type ComparePeriodsOutput, type FinancialChange } from "../schemas/compare-periods.schema.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";

export class ComparisonService {
  constructor(
    private readonly repository: AnalyticsReader,
    private readonly user: AuthenticatedUser,
  ) {}

  async compararPeriodos(input: ComparePeriodsInput): Promise<ComparePeriodsOutput> {
    const previous = { userId: this.user.id, ...input.previousPeriod, currency: input.currency };
    const current = { userId: this.user.id, ...input.currentPeriod, currency: input.currency };
    const [prevSummary, currSummary, prevCategories, currCategories] = await Promise.all([
      this.repository.obtenerResumen(previous), this.repository.obtenerResumen(current),
      this.repository.obtenerGastoPorCategoria(previous), this.repository.obtenerGastoPorCategoria(current),
    ]);

    const currencies = new Set([...prevSummary, ...currSummary, ...prevCategories, ...currCategories].map((row) => row.currency));
    const comparisons = [...currencies].sort().map((currency) => {
      const p = prevSummary.find((row) => row.currency === currency);
      const c = currSummary.find((row) => row.currency === currency);
      const pCategories = prevCategories.filter((row) => row.currency === currency);
      const cCategories = currCategories.filter((row) => row.currency === currency);
      const categoryNames = new Set([...pCategories, ...cCategories].map((row) => row.category));
      const categories = [...categoryNames].map((category) => ({
        category,
        change: change(cCategories.find((row) => row.category === category)?.amount ?? "0", pCategories.find((row) => row.category === category)?.amount ?? "0"),
      })).sort(compareCategorySpend);
      return {
        currency,
        income: change(c?.total_income ?? "0", p?.total_income ?? "0"),
        expenses: change(c?.total_expenses ?? "0", p?.total_expenses ?? "0"),
        netCashFlow: change(c?.net_cash_flow ?? "0", p?.net_cash_flow ?? "0"),
        savingsRate: c?.savings_rate == null && p?.savings_rate == null ? null : change(c?.savings_rate ?? "0", p?.savings_rate ?? "0"),
        categories,
      };
    });

    return {
      comparisons,
      metadata: {
        queriedAt: new Date().toISOString(),
        previousPeriod: input.previousPeriod,
        currentPeriod: input.currentPeriod,
        ...(input.currency ? { currency: input.currency } : {}),
      },
    };
  }
}

function compareCategorySpend(
  left: { category: string; change: FinancialChange },
  right: { category: string; change: FinancialChange },
): number {
  const leftPeak = maxDecimal(left.change.previousValue, left.change.currentValue);
  const rightPeak = maxDecimal(right.change.previousValue, right.change.currentValue);
  const bySpend = compareDecimal(rightPeak, leftPeak);
  return bySpend === 0 ? left.category.localeCompare(right.category) : bySpend;
}

function maxDecimal(left: string, right: string): string {
  return compareDecimal(left, right) >= 0 ? left : right;
}

function change(currentValue: string, previousValue: string): FinancialChange {
  const comparison = compareDecimal(currentValue, previousValue);
  return {
    previousValue, currentValue,
    absoluteChange: subtractDecimal(currentValue, previousValue),
    percentageChange: percentageChange(currentValue, previousValue),
    trend: previousValue === "0" || /^0(?:\.0+)?$/.test(previousValue)
      ? compareDecimal(currentValue, "0") === 0 ? "unchanged" : "no_baseline"
      : comparison > 0 ? "increased" : comparison < 0 ? "decreased" : "unchanged",
  };
}
