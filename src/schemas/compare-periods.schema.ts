import { z } from "zod";
import { DecimalMonetarioSchema } from "../domain/analytics.js";
import { FinancialPeriodInputSchema } from "./analytics.schema.js";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PeriodSchema = z.object({ startDate: DateSchema, endDate: DateSchema });

export const ComparePeriodsToolInputSchema = z.object({
  previousPeriod: PeriodSchema,
  currentPeriod: PeriodSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

export const ComparePeriodsInputSchema = ComparePeriodsToolInputSchema.superRefine((data, ctx) => {
  for (const key of ["previousPeriod", "currentPeriod"] as const) {
    const result = FinancialPeriodInputSchema.safeParse({ ...data[key], currency: data.currency });
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] });
    }
  }
});
export type ComparePeriodsInput = z.infer<typeof ComparePeriodsInputSchema>;

const ChangeSchema = z.object({
  previousValue: DecimalMonetarioSchema,
  currentValue: DecimalMonetarioSchema,
  absoluteChange: DecimalMonetarioSchema,
  percentageChange: DecimalMonetarioSchema.nullable(),
  trend: z.enum(["increased", "decreased", "unchanged", "no_baseline"]),
});

export const ComparePeriodsOutputSchema = z.object({
  comparisons: z.array(z.object({
    currency: z.string().length(3),
    income: ChangeSchema,
    expenses: ChangeSchema,
    netCashFlow: ChangeSchema,
    savingsRate: ChangeSchema.nullable(),
    categories: z.array(z.object({ category: z.string(), change: ChangeSchema })),
  })),
  metadata: z.object({
    queriedAt: z.string().datetime(),
    previousPeriod: PeriodSchema,
    currentPeriod: PeriodSchema,
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  }),
});
export type ComparePeriodsOutput = z.infer<typeof ComparePeriodsOutputSchema>;
export type FinancialChange = z.infer<typeof ChangeSchema>;
