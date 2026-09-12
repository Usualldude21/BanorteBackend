export type PaymentWriteToolName = "create_payment_intent" | "cancel_payment_intent";

export interface PaymentWritePermission {
  toolName: PaymentWriteToolName;
  paymentIntentId?: string;
  payment?: { sourceAccountId: string; beneficiaryId: string; amount: string; currency: string; concept?: string | undefined };
}

export interface PaymentWriteGrant {
  actorId: string;
  sessionId: string;
  correlationId: string;
  interfaceRevision: number;
  dataRevision: number;
  permissions: readonly PaymentWritePermission[];
}

export interface PaymentWriteAttempt {
  actorId: string;
  toolName: PaymentWriteToolName;
  paymentIntentId?: string;
  payment?: PaymentWritePermission["payment"];
}

export interface PaymentWriteAuthorizer {
  consume(attempt: PaymentWriteAttempt): boolean;
}

export function createPaymentWriteAuthorizer(
  grant?: PaymentWriteGrant,
): PaymentWriteAuthorizer {
  const consumed = new Set<number>();

  return {
    consume(attempt) {
      if (!isValidGrant(grant) || attempt.actorId !== grant.actorId) return false;
      const permissionIndex = grant.permissions.findIndex((permission, index) => (
        !consumed.has(index)
        && permission.toolName === attempt.toolName
        && (!permission.payment || (attempt.payment
          && permission.payment.sourceAccountId === attempt.payment.sourceAccountId
          && permission.payment.beneficiaryId === attempt.payment.beneficiaryId
          && minorUnits(permission.payment.amount) !== undefined
          && minorUnits(permission.payment.amount) === minorUnits(attempt.payment.amount)
          && permission.payment.currency === attempt.payment.currency
          && (permission.payment.concept ?? "") === (attempt.payment.concept ?? "")))
        && (permission.paymentIntentId === undefined
          || permission.paymentIntentId === attempt.paymentIntentId)
      ));
      if (permissionIndex < 0) return false;

      consumed.add(permissionIndex);
      return true;
    },
  };
}

function minorUnits(amount: string): bigint | undefined {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/u.test(amount)) return undefined;
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function isValidGrant(grant?: PaymentWriteGrant): grant is PaymentWriteGrant {
  return Boolean(
    grant
    && grant.sessionId.length > 0
    && grant.correlationId.length > 0
    && Number.isSafeInteger(grant.interfaceRevision)
    && grant.interfaceRevision >= 0
    && Number.isSafeInteger(grant.dataRevision)
    && grant.dataRevision >= 0
    && grant.permissions.length > 0,
  );
}
