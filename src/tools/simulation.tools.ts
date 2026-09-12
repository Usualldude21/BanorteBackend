import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SimulateLoanInputSchema,
  SimulateLoanToolInputSchema,
  SimulateSavingsInputSchema,
  SimulateSavingsToolInputSchema,
} from "../schemas/simulation.schema.js";
import { type SimulationService } from "../services/simulation.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";

export function registerSimulationTools(
  server: McpServer,
  service: SimulationService,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool("simulate_loan", {
    title: "Simular crédito",
    description: "Calcula pagos y tabla de amortización con tasa fija. Es una simulación matemática, no una oferta de crédito.",
    inputSchema: SimulateLoanToolInputSchema,
  }, async (input) => toolResponse(rateLimiter, "simulate_loan", () => service.simulateLoan(SimulateLoanInputSchema.parse(input))));

  server.registerTool("simulate_savings", {
    title: "Simular ahorro",
    description: "Proyecta aportaciones e interés compuesto con contribuciones al final de cada periodo. Es una estimación matemática.",
    inputSchema: SimulateSavingsToolInputSchema,
  }, async (input) => toolResponse(rateLimiter, "simulate_savings", () => service.simulateSavings(SimulateSavingsInputSchema.parse(input))));
}

function toolResponse(rateLimiter: ToolRateLimiter, toolName: string, operation: () => unknown) {
  try {
    rateLimiter.consume(toolName);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(operation(), null, 2) }],
    };
  } catch (error) {
    return {
      isError: true as const,
      content: [{
        type: "text" as const,
        text: error instanceof RateLimitError
          ? "Límite de solicitudes alcanzado. Inténtalo más tarde."
          : "No fue posible completar la simulación.",
      }],
    };
  }
}
