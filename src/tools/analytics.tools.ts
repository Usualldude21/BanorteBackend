import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RepositoryError } from "../errors/repository.error.js";
import {
  CashflowInputSchema,
  CashflowToolInputSchema,
  FinancialPeriodInputSchema,
  FinancialPeriodToolInputSchema,
} from "../schemas/analytics.schema.js";
import { type AnalyticsService } from "../services/analytics.service.js";
import {
  ComparePeriodsInputSchema,
  ComparePeriodsToolInputSchema,
} from "../schemas/compare-periods.schema.js";
import { type ComparisonService } from "../services/comparison.service.js";
import { ToolRateLimiter } from "../application/tool-rate-limiter.js";
import { RateLimitError } from "../application/errors/rate-limit.error.js";
import {
  classifyRepositoryError,
  createToolErrorResult,
} from "../application/tool-error-result.js";

export function registrarHerramientasAnalytics(server: McpServer, service: AnalyticsService, rateLimiter: ToolRateLimiter): void {
  server.registerTool("get_financial_summary", {
    title: "Resumen financiero",
    description: "Calcula ingresos, gastos, flujo neto, tasa de ahorro, conteos y movimientos extremos por moneda. Los cálculos provienen de PostgreSQL numeric.",
    inputSchema: FinancialPeriodToolInputSchema,
  }, async (input) => ejecutar(rateLimiter, "get_financial_summary", () => service.obtenerResumen(FinancialPeriodInputSchema.parse(input))));

  server.registerTool("get_spending_by_category", {
    title: "Gasto por categoría",
    description: "Agrupa gastos por categoría y moneda e incluye monto, porcentaje del gasto y número de transacciones.",
    inputSchema: FinancialPeriodToolInputSchema,
  }, async (input) => ejecutar(rateLimiter, "get_spending_by_category", () => service.obtenerGastoPorCategoria(FinancialPeriodInputSchema.parse(input))));

  server.registerTool("get_cashflow", {
    title: "Flujo de efectivo",
    description: "Calcula ingresos, gastos y flujo neto por día, semana o mes, siempre separados por moneda.",
    inputSchema: CashflowToolInputSchema,
  }, async (input) => ejecutar(rateLimiter, "get_cashflow", () => service.obtenerCashflow(CashflowInputSchema.parse(input))));
}

export function registrarHerramientaComparePeriods(server: McpServer, service: ComparisonService, rateLimiter: ToolRateLimiter): void {
  server.registerTool("compare_periods", {
    title: "Comparar periodos financieros",
    description: "Compara ingresos, gastos, flujo neto, tasa de ahorro y categorías entre dos periodos. Separa monedas y maneja bases iguales a cero.",
    inputSchema: ComparePeriodsToolInputSchema,
  }, async (input) => ejecutar(rateLimiter, "compare_periods", () => service.compararPeriodos(ComparePeriodsInputSchema.parse(input))));
}

async function ejecutar(rateLimiter: ToolRateLimiter, toolName: string, operacion: () => Promise<unknown>) {
  try {
    rateLimiter.consume(toolName);
    return { content: [{ type: "text" as const, text: JSON.stringify(await operacion(), null, 2) }] };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return createToolErrorResult(
        "Límite de solicitudes alcanzado. Inténtalo más tarde.",
        "rate_limited",
      );
    }
    if (error instanceof RepositoryError) {
      const details = classifyRepositoryError(error.code);
      return createToolErrorResult(
        error.code === "UNAUTHORIZED"
          ? "No tienes autorización para consultar estos datos financieros."
          : "No fue posible consultar los datos financieros. Inténtalo de nuevo.",
        details.code,
        details.retryable,
      );
    }
    return createToolErrorResult(
      "Error interno al calcular las métricas financieras. Inténtalo de nuevo.",
      "internal",
    );
  }
}
