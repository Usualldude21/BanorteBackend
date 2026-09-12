import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import { classifyRepositoryError, createToolErrorResult } from "../application/tool-error-result.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RepositoryError } from "../errors/repository.error.js";
import { GetBeneficiariesInputSchema } from "../schemas/beneficiary.schema.js";
import { type BeneficiaryService } from "../services/beneficiary.service.js";

export function registerGetBeneficiariesTool(
  server: McpServer,
  service: BeneficiaryService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool("get_beneficiaries", {
    title: "Consultar beneficiarios",
    description: "Obtiene los beneficiarios activos del usuario autenticado necesarios para preparar un pago.",
    inputSchema: GetBeneficiariesInputSchema,
  }, async () => {
    try {
      rateLimiter.consume("get_beneficiaries");
      return { content: [{ type: "text" as const, text: JSON.stringify(await service.listActive(), null, 2) }] };
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createToolErrorResult("Límite de solicitudes alcanzado. Inténtalo más tarde.", "rate_limited");
      }
      if (error instanceof RepositoryError) {
        const details = classifyRepositoryError(error.code);
        return createToolErrorResult("No fue posible consultar los beneficiarios.", details.code, details.retryable);
      }
      return createToolErrorResult("Error interno al consultar beneficiarios.", "internal");
    }
  });
}
