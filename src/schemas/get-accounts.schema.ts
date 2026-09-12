import { z } from "zod";
import { AccountTypeSchema, AccountStatusSchema } from "../domain/account.js";

export const GetAccountsInputSchema = z.object({
});

export type GetAccountsInput = z.infer<typeof GetAccountsInputSchema>;

/**
 * Proyección pública de una cuenta para el consumo del agente.
 *
 * Excluye deliberadamente:
 * - `user_id`: el agente ya lo conoce por ser el input.
 * - `updated_at` / `created_at`: ruido para el razonamiento del agente
 *   en esta fase; se añadirá cuando haya casos de uso que lo requieran.
 */
export const AccountProjectionSchema = z.object({
  id: z.string().uuid(),
  type: AccountTypeSchema,
  status: AccountStatusSchema,
  name: z.string(),
  currency: z.string(),
  balance: z
    .string()
    .describe(
      "Balance exacto en formato decimal string. No operar con aritmética float.",
    ),
  maskedIdentifier: z.string().regex(/^\*{4,}\d{4}$/).nullable(),
});

export type AccountProjection = z.infer<typeof AccountProjectionSchema>;

export const GetAccountsOutputSchema = z.object({
  accounts: z.array(AccountProjectionSchema),
  metadata: z.object({
    totalAccounts: z.number().int().nonnegative(),
    queriedAt: z.string().datetime(),
  }),
});

export type GetAccountsOutput = z.infer<typeof GetAccountsOutputSchema>;
