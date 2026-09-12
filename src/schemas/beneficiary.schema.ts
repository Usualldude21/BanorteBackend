import { z } from "zod";
import { CurrencySchema } from "../domain/account.js";

export const GetBeneficiariesInputSchema = z.object({}).strict();

export const BeneficiaryProjectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  institution: z.string().nullable(),
  accountType: z.string().nullable(),
  maskedAccount: z.string().regex(/^\*{4,}\d{4}$/),
  currency: CurrencySchema,
  status: z.literal("active"),
}).strict();

export const GetBeneficiariesOutputSchema = z.object({
  beneficiaries: z.array(BeneficiaryProjectionSchema).max(100),
  metadata: z.object({
    totalBeneficiaries: z.number().int().nonnegative(),
    queriedAt: z.string().datetime(),
  }).strict(),
}).strict();

export type GetBeneficiariesOutput = z.infer<typeof GetBeneficiariesOutputSchema>;
