import { type AnalyticsReader } from "../application/ports/financial-data.js";
import { type CashflowInput, type CashflowOutput, type FinancialPeriodInput, type FinancialSummaryOutput, type SpendingByCategoryOutput } from "../schemas/analytics.schema.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";

export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsReader,
    private readonly user: AuthenticatedUser,
  ) {}

  async obtenerResumen(input: FinancialPeriodInput): Promise<FinancialSummaryOutput> {
    const filas = await this.repository.obtenerResumen({ ...input, userId: this.user.id });
    return {
      summaries: filas.map((fila) => ({
        currency: fila.currency,
        totalIncome: fila.total_income,
        totalExpenses: fila.total_expenses,
        netCashFlow: fila.net_cash_flow,
        savingsRate: fila.savings_rate,
        transactionCount: fila.transaction_count,
        largestExpense: fila.largest_expense,
        largestIncome: fila.largest_income,
      })),
      metadata: metadata(input),
    };
  }

  async obtenerGastoPorCategoria(input: FinancialPeriodInput): Promise<SpendingByCategoryOutput> {
    const filas = await this.repository.obtenerGastoPorCategoria({ ...input, userId: this.user.id });
    return {
      categories: filas.map((fila) => ({
        currency: fila.currency,
        category: fila.category,
        amount: fila.amount,
        percentage: fila.percentage,
        transactionCount: fila.transaction_count,
      })),
      metadata: metadata(input),
    };
  }

  async obtenerCashflow(input: CashflowInput): Promise<CashflowOutput> {
    const filas = await this.repository.obtenerCashflow({ ...input, userId: this.user.id });
    return {
      granularity: input.granularity,
      periods: filas.map((fila) => ({
        periodStart: fila.period_start,
        currency: fila.currency,
        income: fila.income,
        expenses: fila.expenses,
        netCashFlow: fila.net_cash_flow,
        transactionCount: fila.transaction_count,
      })),
      metadata: metadata(input),
    };
  }
}

function metadata(input: FinancialPeriodInput) {
  return {
    queriedAt: new Date().toISOString(),
    startDate: input.startDate,
    endDate: input.endDate,
    ...(input.currency ? { currency: input.currency } : {}),
  };
}
