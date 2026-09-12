import { z } from "zod";
import { CurrencySchema } from "./account.js";

export const BeneficiarySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  institution: z.string().nullable(),
  account_type: z.string().nullable(),
  masked_account: z.string().regex(/^\*{4,}\d{4}$/),
  currency: CurrencySchema,
  status: z.enum(["active", "blocked"]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export type Beneficiary = z.infer<typeof BeneficiarySchema>;
