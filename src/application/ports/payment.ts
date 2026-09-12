import { type PaymentIntent, type PaymentReceipt, type PaymentStatus } from "@banorte/contracts";
import { type Beneficiary } from "../../domain/beneficiary.js";

export interface CreatePaymentIntentCommand {
  sourceAccountId: string;
  beneficiaryId: string;
  amount: string;
  currency: string;
  concept: string | null;
  idempotencyKey: string;
}

export interface PaymentStatusResult {
  paymentIntentId: string;
  status: PaymentStatus;
  receiptNumber: string | null;
  amount: string;
  currency: string;
  balanceAfter: string | null;
  executedAt: string | null;
}

export interface CancelPaymentResult {
  id: string;
  status: "cancelled";
  updatedAt: string;
}

export interface PaymentGateway {
  createIntent(command: CreatePaymentIntentCommand): Promise<PaymentIntent>;
  confirm(paymentIntentId: string, correlationId: string): Promise<PaymentReceipt>;
  getStatus(paymentIntentId: string): Promise<PaymentStatusResult>;
  cancel(paymentIntentId: string): Promise<CancelPaymentResult>;
}

export interface BeneficiaryReader {
  listActiveByUser(userId: string): Promise<Beneficiary[]>;
}
