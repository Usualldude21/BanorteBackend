import { z } from "zod";
import { TransactionTypeSchema } from "./transaction.js";
import { PositiveFinancialDecimalSchema } from "./financial-decimal.js";

export const ANOMALY_QUERY_MAX_ROWS = 2_000;
export const ANOMALY_MIN_SAMPLE_DEFAULT = 8;
export const ANOMALY_MIN_SAMPLE_MAX = 100;
export const ANOMALY_RESULT_LIMIT_DEFAULT = 20;
export const ANOMALY_RESULT_LIMIT_MAX = 100;

export const AnomalyTransactionSchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  type: TransactionTypeSchema,
  amount: PositiveFinancialDecimalSchema,
  currency: z.string().length(3),
  category: z.string().max(100),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type AnomalyTransaction = z.infer<typeof AnomalyTransactionSchema>;

export interface AnomalyFilter {
  userId: string;
  startDate: string;
  endDate: string;
  accountId?: string | undefined;
  category?: string | undefined;
  transactionType?: z.infer<typeof TransactionTypeSchema> | undefined;
  currency?: string | undefined;
}
