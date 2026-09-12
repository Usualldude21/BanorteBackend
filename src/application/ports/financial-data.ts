import { type Account, type AccountFilter } from "../../domain/account.js";
import {
  type AnomalyFilter,
  type AnomalyTransaction,
} from "../../domain/anomaly.js";
import {
  type CashflowGranularity,
  type CashflowRow,
  type SpendingCategoryRow,
  type SummaryRow,
} from "../../domain/analytics.js";
import {
  type Transaction,
  type TransactionFilter,
} from "../../domain/transaction.js";

export interface AccountReader {
  obtenerPorUsuario(filter: AccountFilter): Promise<Account[]>;
}

export interface TransactionReader {
  obtenerPorFiltro(filter: TransactionFilter): Promise<Transaction[]>;
}

export interface AnalyticsReader {
  obtenerResumen(filter: AnalyticsPeriod): Promise<SummaryRow[]>;
  obtenerGastoPorCategoria(filter: AnalyticsPeriod): Promise<SpendingCategoryRow[]>;
  obtenerCashflow(
    filter: AnalyticsPeriod & { granularity: CashflowGranularity },
  ): Promise<CashflowRow[]>;
}

export interface AnomalyTransactionReader {
  obtenerMuestra(filter: AnomalyFilter): Promise<AnomalyTransaction[]>;
}

export interface AnalyticsPeriod {
  userId: string;
  startDate: string;
  endDate: string;
  currency?: string | undefined;
}
