import { z } from "zod";
import { PositiveFinancialDecimalSchema } from "./financial-decimal.js";

export const TRANSACTION_LIMIT_MAX = 100;
export const TRANSACTION_LIMIT_DEFAULT = 20;
export const TRANSACTION_DATE_RANGE_MAX_DAYS = 366;

export const TransactionTypeSchema = z.enum(["income", "expense", "transfer", "payment"]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;
export const FinancialCategorySchema = z.enum([
  "income",
  "housing",
  "transport",
  "groceries",
  "restaurants",
  "entertainment",
  "health",
  "education",
  "subscriptions",
  "transfers",
  "other",
]);
export type FinancialCategory = z.infer<typeof FinancialCategorySchema>;

/**
 * Transacción financiera tal como existe en la BD.
 *
 * `amount` es string para preservar la precisión de NUMERIC(20,2) de Postgres.
 * `transaction_date` es string ISO 8601 formato YYYY-MM-DD (tipo DATE de Postgres).
 */
export const TransactionSchema = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: TransactionTypeSchema,
  amount: PositiveFinancialDecimalSchema,
  currency: z.string().length(3),
  description: z.string().min(1).max(255),
  category: FinancialCategorySchema,
  reference_id: z.string().nullable(),
  transaction_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "transaction_date debe tener formato YYYY-MM-DD"),
  created_at: z.string().datetime({ offset: true }),
});

export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * Parámetros de consulta para el repositorio.
 * Todos los campos son parámetros de posición — nunca se interpolan como strings SQL.
 */
export const TransactionFilterSchema = z.object({
  user_id: z.string().uuid(),
  account_id: z.string().uuid().optional(),
  type: TransactionTypeSchema.optional(),
  category: FinancialCategorySchema.optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  limit: z.number().int().min(1).max(TRANSACTION_LIMIT_MAX),
  offset: z.number().int().min(0),
});

export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;
