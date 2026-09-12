import { z } from "zod";
import { CashflowGranularitySchema, DecimalMonetarioSchema } from "../domain/analytics.js";
import { TRANSACTION_DATE_RANGE_MAX_DAYS } from "../domain/transaction.js";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function esFechaValida(valor: string): boolean {
  if (!ISO_DATE_REGEX.test(valor)) return false;
  const [anio, mes, dia] = valor.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

const FechaSchema = z.string().regex(ISO_DATE_REGEX, "Formato requerido: YYYY-MM-DD").refine(esFechaValida, "Fecha inválida");
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "currency debe ser ISO 4217 en mayúsculas");

export const FinancialPeriodToolInputSchema = z.object({
  startDate: FechaSchema,
  endDate: FechaSchema,
  currency: CurrencySchema.optional(),
});

export const FinancialPeriodInputSchema = FinancialPeriodToolInputSchema.superRefine((data, ctx) => {
  const inicio = Date.parse(`${data.startDate}T00:00:00Z`);
  const fin = Date.parse(`${data.endDate}T00:00:00Z`);
  if (inicio > fin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: "startDate no puede ser posterior a endDate" });
  } else if ((fin - inicio) / 86_400_000 + 1 > TRANSACTION_DATE_RANGE_MAX_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: `El rango no puede superar ${TRANSACTION_DATE_RANGE_MAX_DAYS} días` });
  }
});

export type FinancialPeriodInput = z.infer<typeof FinancialPeriodInputSchema>;

export const CashflowToolInputSchema = z.object({
  ...FinancialPeriodToolInputSchema.shape,
  granularity: CashflowGranularitySchema.default("month"),
});

export const CashflowInputSchema = CashflowToolInputSchema.superRefine((data, ctx) => {
  const result = FinancialPeriodInputSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue(issue);
  }
});
export type CashflowInput = z.infer<typeof CashflowInputSchema>;

const MetadataSchema = z.object({
  queriedAt: z.string().datetime(),
  startDate: FechaSchema,
  endDate: FechaSchema,
  currency: CurrencySchema.optional(),
});

export const FinancialSummaryOutputSchema = z.object({
  summaries: z.array(z.object({
    currency: CurrencySchema,
    totalIncome: DecimalMonetarioSchema,
    totalExpenses: DecimalMonetarioSchema,
    netCashFlow: DecimalMonetarioSchema,
    savingsRate: DecimalMonetarioSchema.nullable(),
    transactionCount: z.number().int().nonnegative(),
    largestExpense: DecimalMonetarioSchema.nullable(),
    largestIncome: DecimalMonetarioSchema.nullable(),
  })),
  metadata: MetadataSchema,
});
export type FinancialSummaryOutput = z.infer<typeof FinancialSummaryOutputSchema>;

export const SpendingByCategoryOutputSchema = z.object({
  categories: z.array(z.object({
    currency: CurrencySchema,
    category: z.string(),
    amount: DecimalMonetarioSchema,
    percentage: DecimalMonetarioSchema,
    transactionCount: z.number().int().nonnegative(),
  })),
  metadata: MetadataSchema,
});
export type SpendingByCategoryOutput = z.infer<typeof SpendingByCategoryOutputSchema>;

export const CashflowOutputSchema = z.object({
  granularity: CashflowGranularitySchema,
  periods: z.array(z.object({
    periodStart: FechaSchema,
    currency: CurrencySchema,
    income: DecimalMonetarioSchema,
    expenses: DecimalMonetarioSchema,
    netCashFlow: DecimalMonetarioSchema,
    transactionCount: z.number().int().nonnegative(),
  })),
  metadata: MetadataSchema,
});
export type CashflowOutput = z.infer<typeof CashflowOutputSchema>;
