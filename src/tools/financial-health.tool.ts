import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import {
  classifyRepositoryError,
  createToolErrorResult,
} from "../application/tool-error-result.js";
import { RepositoryError } from "../errors/repository.error.js";
import {
  EvaluateFinancialHealthInputSchema,
  EvaluateFinancialHealthToolInputSchema,
} from "../schemas/financial-health.schema.js";
import { type FinancialHealthService } from "../services/financial-health.service.js";

export function registerFinancialHealthTool(
  server: McpServer,
  service: FinancialHealthService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool("evaluate_financial_health", {
    title: "Evaluar salud financiera",
    description: "Calcula determinísticamente gasto/ingreso, ahorro, margen mensual, estabilidad, concentración y tendencias usando únicamente datos bancarios observados.",
    inputSchema: EvaluateFinancialHealthToolInputSchema,
  }, async (input) => {
    try {
      rateLimiter.consume("evaluate_financial_health");
      const output = await service.evaluate(EvaluateFinancialHealthInputSchema.parse(input));
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createToolErrorResult("Límite de solicitudes alcanzado. Inténtalo más tarde.", "rate_limited");
      }
      if (error instanceof RepositoryError) {
        const details = classifyRepositoryError(error.code);
        return createToolErrorResult("No fue posible evaluar la salud financiera.", details.code, details.retryable);
      }
      return createToolErrorResult("Error interno al evaluar la salud financiera.", "internal");
    }
  });
}
