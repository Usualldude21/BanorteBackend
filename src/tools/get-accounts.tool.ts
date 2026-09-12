import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../config/logger.js";
import { RepositoryError } from "../errors/repository.error.js";
import { GetAccountsInputSchema } from "../schemas/get-accounts.schema.js";
import { type AccountService } from "../services/account.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import {
  classifyRepositoryError,
  createToolErrorResult,
} from "../application/tool-error-result.js";

const TOOL_NAME = "get_accounts";

export function registrarHerramientaGetAccounts(
  server: McpServer,
  service: AccountService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Obtener cuentas financieras",
      description:
        "Obtiene todas las cuentas financieras asociadas a un usuario. " +
        "Devuelve tipo, nombre, divisa y balance de cada cuenta. " +
        "Utiliza esta herramienta antes de cualquier operación que requiera conocer el estado de las cuentas del usuario.",
      inputSchema: GetAccountsInputSchema,
    },
    async () => {
      logger.debug("Tool get_accounts invocada");

      try {
        rateLimiter.consume(TOOL_NAME);
        const resultado = await service.obtenerCuentasDeUsuario();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultado, null, 2),
            },
          ],
        };
      } catch (error) {
        return manejarError(error);
      }
    },
  );

  logger.debug("Herramienta 'get_accounts' registrada");
}

function manejarError(
  error: unknown,
) {
  if (error instanceof RepositoryError) {
    const mensajePublico = mensajeDeRepositoryError(error);

    logger.warn("get_accounts: error de repositorio", {
      code: error.code,
    });
    const details = classifyRepositoryError(error.code);

    return createToolErrorResult(
      mensajePublico,
      details.code,
      details.retryable,
    );
  }

  if (error instanceof RateLimitError) {
    return createToolErrorResult(
      "Límite de solicitudes alcanzado. Inténtalo más tarde.",
      "rate_limited",
    );
  }

  logger.error("get_accounts: error inesperado", { errorType: getErrorType(error) });

  return createToolErrorResult(
    "Error interno al consultar las cuentas. Inténtalo de nuevo.",
    "internal",
  );
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function mensajeDeRepositoryError(error: RepositoryError): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "No se encontraron cuentas para el usuario especificado.";
    case "UNAUTHORIZED":
      return "No tienes autorización para consultar estas cuentas.";
    case "DATABASE_ERROR":
      return "Error al consultar la base de datos. Inténtalo de nuevo.";
    default:
      return "Error al procesar la solicitud de cuentas.";
  }
}
