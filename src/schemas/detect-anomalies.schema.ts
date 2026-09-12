import { z } from "zod";
import {
  ANOMALY_MIN_SAMPLE_DEFAULT,
  ANOMALY_MIN_SAMPLE_MAX,
  ANOMALY_RESULT_LIMIT_DEFAULT,
  ANOMALY_RESULT_LIMIT_MAX,
} from "../domain/anomaly.js";
import { FinancialCategorySchema, TransactionTypeSchema } from "../domain/transaction.js";
import { FinancialPeriodInputSchema } from "./analytics.schema.js";

export const DetectAnomaliesToolInputSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  accountId: z.string().uuid().optional(),
  category: FinancialCategorySchema.optional(),
  transactionType: TransactionTypeSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  minSampleSize: z.number().int().min(4).max(ANOMALY_MIN_SAMPLE_MAX).default(ANOMALY_MIN_SAMPLE_DEFAULT),
  limit: z.number().int().min(1).max(ANOMALY_RESULT_LIMIT_MAX).default(ANOMALY_RESULT_LIMIT_DEFAULT),
});

export const DetectAnomaliesInputSchema = DetectAnomaliesToolInputSchema.superRefine((input, context) => {
  const period = FinancialPeriodInputSchema.safeParse({
    startDate: input.startDate,
    endDate: input.endDate,
    currency: input.currency,
  });

  if (!period.success) {
    for (const issue of period.error.issues) context.addIssue(issue);
  }
});

export type DetectAnomaliesInput = z.infer<typeof DetectAnomaliesInputSchema>;

export const DetectAnomaliesOutputSchema = z.object({
  anomalies: z.array(z.object({
    transactionId: z.string().uuid(),
    amount: z.string(),
    currency: z.string().length(3),
    category: z.string(),
    transactionType: TransactionTypeSchema,
    transactionDate: z.string(),
    expectedRange: z.object({ lower: z.string(), upper: z.string() }),
    anomalyScore: z.string(),
    classification: z.literal("statistical_anomaly"),
    reason: z.enum(["amount_above_expected_range", "amount_below_expected_range"]),
  })),
  metadata: z.object({
    queriedAt: z.string().datetime(),
    startDate: z.string(),
    endDate: z.string(),
    filters: z.object({
      accountId: z.string().uuid().optional(),
      category: z.string().optional(),
      transactionType: TransactionTypeSchema.optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    }),
    evaluatedTransactions: z.number().int().nonnegative(),
    eligibleGroups: z.number().int().nonnegative(),
    method: z.literal("iqr"),
    minSampleSize: z.number().int(),
  }),
});

export type DetectAnomaliesOutput = z.infer<typeof DetectAnomaliesOutputSchema>;
