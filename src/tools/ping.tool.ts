import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../config/logger.js";
import { PingInputSchema } from "../schemas/ping.schema.js";
import { ejecutarPing } from "../services/ping.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";

const TOOL_NAME = "ping";

export function registrarHerramientaPing(
  server: McpServer,
  rateLimiter: ToolRateLimiter,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Ping",
      description:
        "Verifica que el servidor MCP está vivo y responde correctamente. " +
        "Útil para diagnóstico y health checks.",
      inputSchema: PingInputSchema,
    },
    async (input) => {
      try {
        rateLimiter.consume(TOOL_NAME);
        const resultado = ejecutarPing(input);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultado, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Error en herramienta ping", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof RateLimitError
                ? "Límite de solicitudes alcanzado. Inténtalo más tarde."
                : "No fue posible ejecutar el diagnóstico.",
            },
          ],
        };
      }
    },
  );

  logger.debug("Herramienta 'ping' registrada");
}
