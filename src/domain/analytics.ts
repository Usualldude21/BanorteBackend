import { z } from "zod";
import { DatabaseNumericSchema } from "./financial-decimal.js";

export const DecimalMonetarioSchema = DatabaseNumericSchema;

export const SummaryRowSchema = z.object({
  currency: z.string().length(3),
  total_income: DecimalMonetarioSchema,
  total_expenses: DecimalMonetarioSchema,
  net_cash_flow: DecimalMonetarioSchema,
  savings_rate: DecimalMonetarioSchema.nullable(),
  transaction_count: z.coerce.number().int().nonnegative(),
  largest_expense: DecimalMonetarioSchema.nullable(),
  largest_income: DecimalMonetarioSchema.nullable(),
});
export type SummaryRow = z.infer<typeof SummaryRowSchema>;

export const SpendingCategoryRowSchema = z.object({
  currency: z.string().length(3),
  category: z.string(),
  amount: DecimalMonetarioSchema,
  percentage: DecimalMonetarioSchema,
  transaction_count: z.coerce.number().int().nonnegative(),
});
export type SpendingCategoryRow = z.infer<typeof SpendingCategoryRowSchema>;

export const CashflowRowSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3),
  income: DecimalMonetarioSchema,
  expenses: DecimalMonetarioSchema,
  net_cash_flow: DecimalMonetarioSchema,
  transaction_count: z.coerce.number().int().nonnegative(),
});
export type CashflowRow = z.infer<typeof CashflowRowSchema>;

export const CashflowGranularitySchema = z.enum(["day", "week", "month"]);
export type CashflowGranularity = z.infer<typeof CashflowGranularitySchema>;
