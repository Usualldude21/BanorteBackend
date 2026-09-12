import { z } from "zod";

export const PaymentFrequencySchema = z.enum([
  "monthly",
  "semimonthly",
  "biweekly",
  "weekly",
]);

export type PaymentFrequency = z.infer<typeof PaymentFrequencySchema>;

export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
};

export const MAX_SIMULATION_PERIODS = 2_000;

export function getPaymentCount(
  durationMonths: number,
  frequency: PaymentFrequency,
): number | null {
  const numerator = durationMonths * PAYMENTS_PER_YEAR[frequency];
  return numerator % 12 === 0 ? numerator / 12 : null;
}
