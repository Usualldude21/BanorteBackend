import {
  paymentIntentSchema,
  paymentReceiptSchema,
  paymentStatusSchema,
  type PaymentIntent,
  type PaymentReceipt,
} from "@banorte/contracts";
import { type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type CancelPaymentResult,
  type CreatePaymentIntentCommand,
  type PaymentGateway,
  type PaymentStatusResult,
} from "../application/ports/payment.js";
import { DatabaseNumericSchema } from "../domain/financial-decimal.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";

const IntentRowSchema = z.object({
  id: z.string().uuid(),
  source_account_id: z.string().uuid(),
  beneficiary_id: z.string().uuid(),
  amount: DatabaseNumericSchema,
  currency: z.string(),
  concept: z.string().nullable(),
  fee: DatabaseNumericSchema,
  estimated_balance_after: DatabaseNumericSchema,
  status: paymentStatusSchema,
  idempotency_key: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
}).passthrough();

const ReceiptRowSchema = z.object({
  payment_id: z.string().uuid(),
  payment_intent_id: z.string().uuid(),
  status: z.enum(["succeeded", "failed"]),
  receipt_number: z.string().trim().min(1).max(80),
  amount: DatabaseNumericSchema,
  currency: z.string(),
  fee: DatabaseNumericSchema,
  balance_before: DatabaseNumericSchema,
  balance_after: DatabaseNumericSchema,
  executed_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const StatusRowSchema = z.object({
  payment_intent_id: z.string().uuid(),
  status: paymentStatusSchema,
  receipt_number: z.string().trim().min(1).max(80).nullable(),
  amount: DatabaseNumericSchema,
  currency: z.string(),
  balance_after: DatabaseNumericSchema.nullable(),
  executed_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const CancelRowSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("cancelled"),
  updated_at: z.string().datetime({ offset: true }),
}).passthrough();

export class PaymentRepository implements PaymentGateway {
  constructor(private readonly client: SupabaseClient) {}

  async createIntent(command: CreatePaymentIntentCommand): Promise<PaymentIntent> {
    const row = await this.callSingle("create_payment_intent", {
      p_source_account_id: command.sourceAccountId,
      p_beneficiary_id: command.beneficiaryId,
      p_amount: command.amount,
      p_currency: command.currency,
      p_concept: command.concept,
      p_idempotency_key: command.idempotencyKey,
    }, IntentRowSchema);
    return paymentIntentSchema.parse({
      id: row.id,
      sourceAccountId: row.source_account_id,
      beneficiaryId: row.beneficiary_id,
      amount: String(row.amount),
      currency: row.currency,
      concept: row.concept,
      fee: String(row.fee),
      estimatedBalanceAfter: String(row.estimated_balance_after),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      expiresAt: row.expires_at,
    });
  }

  async confirm(paymentIntentId: string, correlationId: string): Promise<PaymentReceipt> {
    const row = await this.callSingle("confirm_payment", {
      p_payment_intent_id: paymentIntentId,
      p_correlation_id: correlationId,
    }, ReceiptRowSchema);
    return paymentReceiptSchema.parse({
      paymentId: row.payment_id,
      paymentIntentId: row.payment_intent_id,
      status: row.status,
      receiptNumber: row.receipt_number,
      amount: String(row.amount),
      currency: row.currency,
      fee: String(row.fee),
      balanceBefore: String(row.balance_before),
      balanceAfter: String(row.balance_after),
      executedAt: row.executed_at,
    });
  }

  async getStatus(paymentIntentId: string): Promise<PaymentStatusResult> {
    const row = await this.callSingle("get_payment_status", {
      p_payment_intent_id: paymentIntentId,
    }, StatusRowSchema);
    return {
      paymentIntentId: row.payment_intent_id,
      status: row.status,
      receiptNumber: row.receipt_number,
      amount: String(row.amount),
      currency: row.currency,
      balanceAfter: row.balance_after === null ? null : String(row.balance_after),
      executedAt: row.executed_at,
    };
  }

  async cancel(paymentIntentId: string): Promise<CancelPaymentResult> {
    const row = await this.callSingle("cancel_payment_intent", {
      p_payment_intent_id: paymentIntentId,
    }, CancelRowSchema);
    return { id: row.id, status: row.status, updatedAt: row.updated_at };
  }

  private async callSingle<T>(
    functionName: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { data } = await telemetry.observe(
      { component: "supabase", operation: "rpc", queryName: functionName },
      async () => {
        const result = await this.client.rpc(functionName, parameters);
        if (result.error) throw mapearErrorSupabase(result.error, `rpc.${functionName}`);
        return result;
      },
      (result) => ({ resultCount: Array.isArray(result.data) ? result.data.length : 0 }),
    );
    if (!Array.isArray(data) || data.length !== 1) {
      throw new RepositoryError(`rpc.${functionName} no devolvió un resultado`, "NOT_FOUND");
    }
    const result = schema.safeParse(data[0]);
    if (!result.success) {
      throw new RepositoryError(`Respuesta inválida de rpc.${functionName}`, "DATABASE_ERROR", result.error);
    }
    return result.data;
  }
}
