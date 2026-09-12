import { financialHealthSchema } from "@banorte/contracts";
import { z } from "zod";
import {
  FinancialPeriodInputSchema,
  FinancialPeriodToolInputSchema,
} from "./analytics.schema.js";

const MoneySchema = z.string().regex(/^-?\d+\.\d{2}$/);
const PercentageSchema = z.string().regex(/^-?\d+\.\d{2}$/);

export const EvaluateFinancialHealthToolInputSchema = FinancialPeriodToolInputSchema;
export const EvaluateFinancialHealthInputSchema = FinancialPeriodInputSchema;
export type EvaluateFinancialHealthInput = z.infer<typeof EvaluateFinancialHealthInputSchema>;

const TrendSchema = z.object({
  metric: z.enum(["income", "expenses", "net_cash_flow"]),
  fromPeriod: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toPeriod: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  previousValue: MoneySchema,
  currentValue: MoneySchema,
  percentageChange: PercentageSchema.nullable(),
  direction: z.enum(["increased", "decreased", "unchanged", "no_baseline"]),
}).strict();

export const FinancialHealthAssessmentSchema = financialHealthSchema.extend({
  observed: z.object({
    totalIncome: MoneySchema,
    totalExpenses: MoneySchema,
    monthsObserved: z.number().int().nonnegative(),
    topExpenseCategory: z.object({
      category: z.string().min(1).max(100),
      amount: MoneySchema,
    }).strict().nullable(),
  }).strict(),
  metrics: z.object({
    expenseToIncomeRatio: PercentageSchema.nullable(),
    averageMonthlyMargin: MoneySchema,
    cashflowStability: z.object({
      score: PercentageSchema.nullable(),
      rating: z.enum(["high", "medium", "low", "insufficient_data"]),
      method: z.literal("mean_absolute_deviation"),
    }).strict(),
    categoryConcentration: z.object({
      percentage: PercentageSchema.nullable(),
      category: z.string().min(1).max(100).nullable(),
    }).strict(),
  }).strict(),
  trends: z.array(TrendSchema).max(3),
}).strict();

export const EvaluateFinancialHealthOutputSchema = z.object({
  dataType: z.literal("OBSERVED"),
  health: z.array(FinancialHealthAssessmentSchema),
  metadata: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    calculatedAt: z.string().datetime(),
    formulasVersion: z.literal("1.0"),
  }).strict(),
}).strict();

export type FinancialHealthAssessment = z.infer<typeof FinancialHealthAssessmentSchema>;
export type EvaluateFinancialHealthOutput = z.infer<typeof EvaluateFinancialHealthOutputSchema>;
