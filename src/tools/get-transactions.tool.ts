import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../config/logger.js";
import { RepositoryError } from "../errors/repository.error.js";
import {
  GetTransactionsInputSchema,
  GetTransactionsToolInputSchema,
} from "../schemas/get-transactions.schema.js";
import { type TransactionService } from "../services/transaction.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import {
  classifyRepositoryError,
  createToolErrorResult,
} from "../application/tool-error-result.js";

const TOOL_NAME = "get_transactions";

export function registrarHerramientaGetTransactions(
  server: McpServer,
  service: TransactionService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Obtener transacciones financieras",
      description:
        "Consulta el historial de transacciones financieras de un usuario con filtros opcionales. " +
        "Soporta filtrado por cuenta, rango de fechas (máximo 366 días), categoría y tipo " +
        "(income, expense, transfer). Los resultados se paginas con limit y offset. " +
        "Usa esta herramienta para analizar el historial financiero de un usuario.",
      inputSchema: GetTransactionsToolInputSchema,
    },
    async (input) => {
      logger.debug("Tool get_transactions invocada");

      try {
        rateLimiter.consume(TOOL_NAME);
        const resultado = await service.obtenerTransacciones(
          GetTransactionsInputSchema.parse(input),
        );

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

  logger.debug("Herramienta 'get_transactions' registrada");
}

function manejarError(
  error: unknown,
) {
  if (error instanceof RepositoryError) {
    const mensajePublico = mensajeDeRepositoryError(error);

    logger.warn("get_transactions: error de repositorio", {
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

  logger.error("get_transactions: error inesperado", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });

  return createToolErrorResult(
    "Error interno al consultar las transacciones. Inténtalo de nuevo.",
    "internal",
  );
}

function mensajeDeRepositoryError(error: RepositoryError): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "No se encontraron transacciones para los filtros especificados.";
    case "UNAUTHORIZED":
      return "No tienes autorización para consultar estas transacciones.";
    case "DATABASE_ERROR":
      return "Error al consultar la base de datos. Inténtalo de nuevo.";
    default:
      return "Error al procesar la solicitud de transacciones.";
  }
}
