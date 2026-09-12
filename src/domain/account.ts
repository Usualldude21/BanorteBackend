import { z } from "zod";
import { FinancialDecimalSchema } from "./financial-decimal.js";

/**
 * Tipos de cuenta bancaria/financiera.
 * Valores en inglés para coincidir con el enum de Postgres.
 */
export const AccountTypeSchema = z.enum([
  "checking",
  "savings",
  "credit_card",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

/**
 * Estado del ciclo de vida de una cuenta.
 */
export const AccountStatusSchema = z.enum([
  "active",
  "blocked",
  "closed",
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

/**
 * Códigos de divisa ISO 4217.
 * Solo los más comunes para esta fase; se amplía en fases posteriores.
 */
export const CurrencySchema = z
  .string()
  .length(3, "La divisa debe ser un código ISO 4217 de 3 caracteres")
  .toUpperCase();
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * Representación completa de una cuenta financiera tal como existe en la BD.
 *
 * `balance` se representa como `string` para preservar la precisión exacta
 * del tipo NUMERIC(20,2) de Postgres. El cliente nunca debe operar sobre
 * este valor directamente con aritmética de punto flotante JS.
 */
export const AccountSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: AccountTypeSchema,
  status: AccountStatusSchema,
  name: z.string().min(1).max(100),
  currency: CurrencySchema,
  balance: FinancialDecimalSchema,
  masked_identifier: z.string().regex(/^\*{4,}\d{4}$/).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Account = z.infer<typeof AccountSchema>;

/**
 * Parámetros para filtrar cuentas.
 * Tipado estrictamente para que el repositorio no acepte filtros arbitrarios.
 */
export const AccountFilterSchema = z.object({
  user_id: z.string().uuid(),
  type: AccountTypeSchema.optional(),
  status: AccountStatusSchema.optional(),
  currency: CurrencySchema.optional(),
});

export type AccountFilter = z.infer<typeof AccountFilterSchema>;
