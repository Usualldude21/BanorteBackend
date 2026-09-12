import { z } from "zod";
import {
  getPaymentCount,
  MAX_SIMULATION_PERIODS,
  PaymentFrequencySchema,
} from "../domain/simulation.js";

const MoneySchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Usa un importe positivo con máximo dos decimales")
  .refine((value) => Number(value) > 0, "El importe debe ser mayor que cero");

const NonNegativeMoneySchema = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const RateSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "La tasa debe tener hasta seis decimales")
  .refine((value) => Number(value) <= 100, "La tasa anual no puede superar 100%");

const DurationAndFrequencySchema = z.object({
  durationMonths: z.number().int().min(1).max(600),
  paymentFrequency: PaymentFrequencySchema,
}).superRefine((input, context) => {
  const count = getPaymentCount(input.durationMonths, input.paymentFrequency);
  if (count === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationMonths"],
      message: "La duración debe producir un número entero de pagos para la frecuencia elegida",
    });
  } else if (count > MAX_SIMULATION_PERIODS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationMonths"],
      message: `La simulación no puede superar ${MAX_SIMULATION_PERIODS} periodos`,
    });
  }
});

export const SimulateLoanToolInputSchema = z.object({
  principal: MoneySchema,
  annualInterestRate: RateSchema,
  termMonths: z.number().int().min(1).max(600),
  paymentFrequency: PaymentFrequencySchema,
});

export const SimulateLoanInputSchema = SimulateLoanToolInputSchema.superRefine((input, context) => {
  const result = DurationAndFrequencySchema.safeParse({
    durationMonths: input.termMonths,
    paymentFrequency: input.paymentFrequency,
  });
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ ...issue, path: issue.path.map((part) => part === "durationMonths" ? "termMonths" : part) });
    }
  }
});

export type SimulateLoanInput = z.infer<typeof SimulateLoanInputSchema>;

export const SimulateSavingsToolInputSchema = z.object({
  initialAmount: NonNegativeMoneySchema,
  periodicContribution: NonNegativeMoneySchema,
  annualRate: RateSchema,
  durationMonths: z.number().int().min(1).max(600),
  frequency: PaymentFrequencySchema,
});

export const SimulateSavingsInputSchema = SimulateSavingsToolInputSchema.superRefine((input, context) => {
  const result = DurationAndFrequencySchema.safeParse({
    durationMonths: input.durationMonths,
    paymentFrequency: input.frequency,
  });
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue(issue);
  }
  if (Number(input.initialAmount) === 0 && Number(input.periodicContribution) === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["initialAmount"], message: "La simulación requiere un monto inicial o una contribución" });
  }
});

export type SimulateSavingsInput = z.infer<typeof SimulateSavingsInputSchema>;

const MoneyOutputSchema = z.string().regex(/^\d+\.\d{2}$/);

export const SimulateLoanOutputSchema = z.object({
  dataType: z.literal("SIMULATED"),
  paymentAmount: MoneyOutputSchema,
  totalInterest: MoneyOutputSchema,
  totalPaid: MoneyOutputSchema,
  numberOfPayments: z.number().int().positive(),
  amortizationSchedule: z.array(z.object({
    paymentNumber: z.number().int().positive(),
    paymentAmount: MoneyOutputSchema,
    principalPaid: MoneyOutputSchema,
    interestPaid: MoneyOutputSchema,
    remainingBalance: MoneyOutputSchema,
  })),
});

export type SimulateLoanOutput = z.infer<typeof SimulateLoanOutputSchema>;

export const SimulateSavingsOutputSchema = z.object({
  dataType: z.literal("SIMULATED"),
  projectedBalance: MoneyOutputSchema,
  totalContributions: MoneyOutputSchema,
  estimatedGrowth: MoneyOutputSchema,
  numberOfPeriods: z.number().int().positive(),
  timeline: z.array(z.object({
    period: z.number().int().positive(),
    contribution: MoneyOutputSchema,
    interestEarned: MoneyOutputSchema,
    balance: MoneyOutputSchema,
  })),
});

export type SimulateSavingsOutput = z.infer<typeof SimulateSavingsOutputSchema>;
