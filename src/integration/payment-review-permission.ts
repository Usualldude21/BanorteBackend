import type { UIEvent, UINode, UISpecification } from "@banorte/contracts";
import type { PaymentWritePermission } from "../application/ports/payment-write-authorization.js";
import { CreatePaymentIntentInputSchema } from "../schemas/payment.schema.js";
import { validateSubmittedForm, SharedUiEventValidationError } from "./shared-ui-event.js";

export function paymentReviewPermission(event: UIEvent, specification: UISpecification, originalRequest: string, pendingIntent?: string): PaymentWritePermission | undefined {
  if (event.event.name !== "form.submit") return undefined;
  const find = (node: UINode): UINode | undefined => {
    if (node.id === event.event.sourceId) return node;
    const children = "children" in node ? node.children : node.type === "tabs" || node.type === "accordion" ? node.items.flatMap((item) => item.children) : [];
    for (const child of children) { const found = find(child); if (found) return found; }
    return undefined;
  };
  const button = find(specification.root);
  if (button?.type !== "button" || !/(?:revis|prepar).*pago/iu.test(button.label)) return undefined;
  if (pendingIntent) throw new SharedUiEventValidationError("Ya existe un pago pendiente: revisa o cancela antes de preparar otro");
  const fields = validateSubmittedForm(event, specification);
  const one = (pattern: RegExp): string | undefined => {
    const matches = fields.filter((field) => pattern.test(field.label));
    if (matches.length > 1) throw new SharedUiEventValidationError("El formulario tiene roles financieros ambiguos");
    return matches[0]?.value;
  };
  const explicitAmounts = [...originalRequest.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gu)].map((match) => match[1]!.replaceAll(",", ""));
  const currencies = [...new Set(originalRequest.match(/\b(?:MXN|USD|EUR)\b/gu) ?? [])];
  const input = CreatePaymentIntentInputSchema.safeParse({
    sourceAccountId: one(/(?:cuenta.*origen|origen)/iu),
    beneficiaryId: one(/(?:beneficiario|destinatario|destino)/iu),
    amount: one(/(?:monto|importe|cantidad)/iu) ?? (explicitAmounts.length === 1 ? explicitAmounts[0] : undefined),
    currency: one(/moneda/iu) ?? (currencies.length === 1 ? currencies[0] : undefined),
    concept: one(/(?:concepto|notas.*pago)/iu) || undefined,
  });
  if (!input.success) throw new SharedUiEventValidationError("Aclara origen, beneficiario, monto y moneda antes de revisar el pago");
  return { toolName: "create_payment_intent", payment: input.data };
}
