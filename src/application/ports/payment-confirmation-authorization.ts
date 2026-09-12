export interface PaymentConfirmationGrant {
  actorId: string;
  paymentIntentId: string;
  sessionId: string;
  correlationId: string;
  interfaceRevision: number;
  dataRevision: number;
}

export interface PaymentConfirmationAttempt {
  actorId: string;
  paymentIntentId: string;
}

export interface PaymentConfirmationAuthorizer {
  consume(attempt: PaymentConfirmationAttempt): boolean;
}

export function createPaymentConfirmationAuthorizer(
  grant?: PaymentConfirmationGrant,
): PaymentConfirmationAuthorizer {
  let consumed = false;

  return {
    consume(attempt) {
      if (
        consumed
        || !grant
        || grant.sessionId.length === 0
        || grant.correlationId.length === 0
        || !Number.isSafeInteger(grant.interfaceRevision)
        || grant.interfaceRevision < 0
        || !Number.isSafeInteger(grant.dataRevision)
        || grant.dataRevision < 0
        || attempt.actorId !== grant.actorId
        || attempt.paymentIntentId !== grant.paymentIntentId
      ) {
        return false;
      }

      consumed = true;
      return true;
    },
  };
}
