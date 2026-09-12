import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RepositoryError } from "../errors/repository.error.js";
import {
  DetectAnomaliesInputSchema,
  DetectAnomaliesToolInputSchema,
} from "../schemas/detect-anomalies.schema.js";
import { type AnomalyService } from "../services/anomaly.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import {
  classifyRepositoryError,
  createToolErrorResult,
} from "../application/tool-error-result.js";

const TOOL_NAME = "detect_transaction_anomalies";

export function registrarHerramientaDetectAnomalies(
  server: McpServer,
  service: AnomalyService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool(TOOL_NAME, {
    title: "Detectar transacciones inusuales",
    description: "Detecta importes fuera del rango intercuartílico histórico de transacciones comparables. El resultado identifica anomalías estadísticas, no fraude.",
    inputSchema: DetectAnomaliesToolInputSchema,
  }, async (input) => {
    try {
      rateLimiter.consume(TOOL_NAME);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            await service.detectar(DetectAnomaliesInputSchema.parse(input)),
            null,
            2,
          ),
        }],
      };
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createToolErrorResult(
          "Límite de solicitudes alcanzado. Inténtalo más tarde.",
          "rate_limited",
        );
      }
      if (error instanceof RepositoryError && error.code === "INVALID_INPUT") {
        return createToolErrorResult(
          "El rango contiene demasiadas transacciones. Reduce el periodo o agrega filtros.",
          "invalid_input",
        );
      }
      if (error instanceof RepositoryError) {
        const details = classifyRepositoryError(error.code);
        return createToolErrorResult(
          "No fue posible analizar las transacciones. Inténtalo de nuevo.",
          details.code,
          details.retryable,
        );
      }
      return createToolErrorResult(
        "No fue posible analizar las transacciones. Inténtalo de nuevo.",
        "internal",
      );
    }
  });
}
