import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type AuthenticatedUser } from "../application/authenticated-user.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import { type PaymentConfirmationAuthorizer } from "../application/ports/payment-confirmation-authorization.js";
import {
  type PaymentWriteAttempt,
  type PaymentWriteAuthorizer,
} from "../application/ports/payment-write-authorization.js";
import { classifyRepositoryError, createToolErrorResult } from "../application/tool-error-result.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RepositoryError } from "../errors/repository.error.js";
import {
  CancelPaymentIntentInputSchema,
  ConfirmPaymentInputSchema,
  CreatePaymentIntentInputSchema,
  GetPaymentStatusInputSchema,
} from "../schemas/payment.schema.js";
import { type PaymentService } from "../services/payment.service.js";

export function registerPaymentTools(
  server: McpServer,
  service: PaymentService,
  rateLimiter: ToolRateLimiter,
  user: AuthenticatedUser,
  writeAuthorizer?: PaymentWriteAuthorizer,
  confirmationAuthorizer?: PaymentConfirmationAuthorizer,
): void {
  if (writeAuthorizer) {
    server.registerTool("create_payment_intent", {
      title: "Preparar pago",
      description: "Prepara un pago y valida cuenta, beneficiario, moneda, monto, saldo y expiración. No mueve dinero y requiere confirmación posterior del usuario.",
      inputSchema: CreatePaymentIntentInputSchema,
    }, async (input) => execute("create_payment_intent", rateLimiter, async () => {
      const parsed = CreatePaymentIntentInputSchema.parse(input);
      authorizeWrite(writeAuthorizer, user, { toolName: "create_payment_intent", payment: parsed });
      return service.createIntent(parsed);
    }));
  }

  if (confirmationAuthorizer) {
    server.registerTool("confirm_payment", {
      title: "Confirmar pago",
      description: "Confirma atómicamente un intent existente. Sólo puede invocarse después de una confirmación explícita y validada desde la UI.",
      inputSchema: ConfirmPaymentInputSchema,
    }, async (input) => execute("confirm_payment", rateLimiter, async () => {
      const parsed = ConfirmPaymentInputSchema.parse(input);
      if (!confirmationAuthorizer.consume({
        actorId: user.id,
        paymentIntentId: parsed.paymentIntentId,
      })) {
        throw new PaymentConfirmationAuthorizationError();
      }
      return service.confirm(parsed);
    }));
  }

  server.registerTool("get_payment_status", {
    title: "Consultar estado de pago",
    description: "Consulta en la base de datos el estado actual y el comprobante de un intent de pago del usuario autenticado.",
    inputSchema: GetPaymentStatusInputSchema,
  }, async (input) => execute("get_payment_status", rateLimiter, async () => (
    service.getStatus(GetPaymentStatusInputSchema.parse(input))
  )));

  if (writeAuthorizer) {
    server.registerTool("cancel_payment_intent", {
      title: "Cancelar pago pendiente",
      description: "Cancela un intent pendiente y no ejecutado perteneciente al usuario autenticado.",
      inputSchema: CancelPaymentIntentInputSchema,
    }, async (input) => execute("cancel_payment_intent", rateLimiter, async () => {
      const parsed = CancelPaymentIntentInputSchema.parse(input);
      authorizeWrite(writeAuthorizer, user, {
        toolName: "cancel_payment_intent",
        paymentIntentId: parsed.paymentIntentId,
      });
      return service.cancel(parsed);
    }));
  }
}

async function execute(
  toolName: string,
  rateLimiter: ToolRateLimiter,
  operation: () => Promise<unknown>,
) {
  try {
    rateLimiter.consume(toolName);
    return { content: [{ type: "text" as const, text: JSON.stringify(await operation(), null, 2) }] };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return createToolErrorResult("Límite de solicitudes alcanzado. Inténtalo más tarde.", "rate_limited");
    }
    if (error instanceof PaymentConfirmationAuthorizationError) {
      return createToolErrorResult("La confirmación del pago no está autorizada por una interacción válida.", "unauthorized");
    }
    if (error instanceof PaymentWriteAuthorizationError) {
      return createToolErrorResult("La operación de pago no está autorizada para esta solicitud.", "unauthorized");
    }
    if (error instanceof z.ZodError) {
      return createToolErrorResult("Los datos del pago no son válidos.", "invalid_input");
    }
    if (error instanceof RepositoryError) {
      const details = classifyRepositoryError(error.code);
      return createToolErrorResult(publicMessage(toolName, error.code), details.code, details.retryable);
    }
    return createToolErrorResult("No fue posible completar la operación de pago.", "internal");
  }
}

class PaymentConfirmationAuthorizationError extends Error {}
class PaymentWriteAuthorizationError extends Error {}

function authorizeWrite(
  authorizer: PaymentWriteAuthorizer,
  user: AuthenticatedUser,
  attempt: Omit<PaymentWriteAttempt, "actorId">,
): void {
  if (!authorizer.consume({ actorId: user.id, ...attempt })) {
    throw new PaymentWriteAuthorizationError();
  }
}

function publicMessage(toolName: string, code: RepositoryError["code"]): string {
  if (code === "INSUFFICIENT_FUNDS") return "Saldo insuficiente. El pago no se realizó.";
  if (code === "UNAUTHORIZED") return "No tienes autorización para realizar esta operación.";
  if (code === "NOT_FOUND") return "El pago o recurso solicitado no existe.";
  if (code === "INVALID_INPUT" || code === "CONFLICT") {
    return toolName === "create_payment_intent"
      ? "No fue posible preparar el pago. Verifica saldo, cuenta, beneficiario, monto y moneda."
      : "El pago no se encuentra en un estado válido para esta operación.";
  }
  return "El servicio de pagos no está disponible temporalmente.";
}
