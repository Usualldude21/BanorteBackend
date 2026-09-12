import {
  currencySchema,
  paymentIntentSchema,
  paymentReceiptSchema,
  paymentStatusSchema,
  positiveFinancialAmountSchema,
} from "@banorte/contracts";
import { z } from "zod";

export const CreatePaymentIntentInputSchema = z.object({
  sourceAccountId: z.string().uuid(),
  beneficiaryId: z.string().uuid(),
  amount: positiveFinancialAmountSchema,
  currency: currencySchema,
  concept: z.string().trim().min(1).max(140).optional(),
}).strict();
export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentInputSchema>;

export const CreatePaymentIntentOutputSchema = paymentIntentSchema;

export const ConfirmPaymentInputSchema = z.object({
  paymentIntentId: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentInputSchema>;

export const ConfirmPaymentOutputSchema = paymentReceiptSchema;

export const GetPaymentStatusInputSchema = z.object({
  paymentIntentId: z.string().uuid(),
}).strict();
export type GetPaymentStatusInput = z.infer<typeof GetPaymentStatusInputSchema>;

export const GetPaymentStatusOutputSchema = z.object({
  paymentIntentId: z.string().uuid(),
  status: paymentStatusSchema,
  receiptNumber: z.string().trim().min(1).max(80).nullable(),
  amount: positiveFinancialAmountSchema,
  currency: currencySchema,
  balanceAfter: z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/).nullable(),
  executedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const CancelPaymentIntentInputSchema = GetPaymentStatusInputSchema;
export type CancelPaymentIntentInput = z.infer<typeof CancelPaymentIntentInputSchema>;
export const CancelPaymentIntentOutputSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("cancelled"),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
