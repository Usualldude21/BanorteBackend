import { randomUUID } from "node:crypto";
import { type PaymentIntent, type PaymentReceipt } from "@banorte/contracts";
import { type PaymentGateway, type PaymentStatusResult, type CancelPaymentResult } from "../application/ports/payment.js";
import {
  CancelPaymentIntentOutputSchema,
  ConfirmPaymentOutputSchema,
  CreatePaymentIntentOutputSchema,
  GetPaymentStatusOutputSchema,
  type ConfirmPaymentInput,
  type CreatePaymentIntentInput,
  type GetPaymentStatusInput,
} from "../schemas/payment.schema.js";

export class PaymentService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly createId: () => string = randomUUID,
  ) {}

  async createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    const result = await this.gateway.createIntent({
      ...input,
      concept: input.concept ?? null,
      idempotencyKey: this.createId(),
    });
    return CreatePaymentIntentOutputSchema.parse(result);
  }

  async confirm(input: ConfirmPaymentInput): Promise<PaymentReceipt> {
    return ConfirmPaymentOutputSchema.parse(
      await this.gateway.confirm(input.paymentIntentId, this.createId()),
    );
  }

  async getStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    return GetPaymentStatusOutputSchema.parse(await this.gateway.getStatus(input.paymentIntentId));
  }

  async cancel(input: GetPaymentStatusInput): Promise<CancelPaymentResult> {
    return CancelPaymentIntentOutputSchema.parse(await this.gateway.cancel(input.paymentIntentId));
  }
}
