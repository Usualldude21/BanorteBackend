import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AuthenticationError } from "../../application/errors/authentication.error.js";
import { GeminiModelError } from "../model/gemini-model.js";
import { AgentExecutionError } from "../orchestrator.js";
import { AgentQuerySchema } from "../schemas/agent.schema.js";
import { createAgentRuntime, type SessionFactory } from "./agent-runtime.js";
import { InteractiveLoginError } from "./interactive-credentials.js";
import { logger } from "../../config/logger.js";
import { paymentWritePermissionsForQuery } from "../payment-write-policy.js";

export async function runAgentCli(sessionFactory: SessionFactory): Promise<void> {
  const query = AgentQuerySchema.parse(process.argv.slice(2).join(" "));
  const runtime = await createAgentRuntime(sessionFactory, {
    paymentWritePermissions: paymentWritePermissionsForQuery(query),
  });
  const requestId = randomUUID();

  try {
    const response = await runtime.orchestrator.answer(query, { streamId: requestId });
    const sources = response.toolsUsed.length > 0
      ? [...new Set(response.toolsUsed)].join(", ")
      : "ninguna";
    process.stdout.write([
      response.answer,
      "",
      `Request ID: ${requestId}`,
      `Fuentes MCP: ${sources}`,
      "",
      "UI DSL:",
      JSON.stringify(response.ui, null, 2),
      "",
    ].join("\n"));
  } finally {
    await runtime.close();
  }
}

export function handleAgentCliError(error: unknown): void {
  logger.error("Agent CLI no pudo completar la consulta", diagnosticMetadata(error));
  const message = error instanceof z.ZodError
    ? "La consulta, el correo o la contraseña no tienen un formato válido"
    : error instanceof AuthenticationError
    ? "No se pudo iniciar sesión. Verifica las credenciales y que el usuario esté confirmado"
    : error instanceof InteractiveLoginError
    ? error.message
    : error instanceof AgentExecutionError || error instanceof GeminiModelError
    ? error.message
    : "No fue posible completar la consulta financiera";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function diagnosticMetadata(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: "UnknownError" };

  return {
    errorType: error.name,
    errorMessage: redactCredentials(error.message),
    ...(error instanceof AuthenticationError && error.originalError instanceof Error
      ? {
          causeType: error.originalError.name,
          causeMessage: redactCredentials(error.originalError.message),
        }
      : {}),
  };
}

function redactCredentials(message: string): string {
  return message
    .replace(/eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}/gu, "[redacted-jwt]")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gu, "[redacted-key]")
    .slice(0, 500);
}
