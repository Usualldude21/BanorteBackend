import { type PaymentWritePermission } from "../application/ports/payment-write-authorization.js";

const CANCEL_PAYMENT_INTENT = /\b(?:cancela(?:r)?|anula(?:r)?|det[eé]n|detener|cancel|void)\b.{0,60}\b(?:pago|transferencia|payment|transfer|intent)\b|\b(?:pago|transferencia|payment|transfer|intent)\b.{0,60}\b(?:cancela(?:r)?|anula(?:r)?|cancel|void)\b/iu;

export function paymentWritePermissionsForQuery(
  query: string,
  pendingPaymentIntentId?: string,
): PaymentWritePermission[] {
  const permissions: PaymentWritePermission[] = [];
  // A text request may prepare capture UI, but only the validated Review
  // UIEvent can grant a parameter-bound create_payment_intent capability.
  if (pendingPaymentIntentId && CANCEL_PAYMENT_INTENT.test(query)) {
    permissions.push({
      toolName: "cancel_payment_intent",
      paymentIntentId: pendingPaymentIntentId,
    });
  }
  return permissions;
}
