import { type SupabaseClient } from "@supabase/supabase-js";
import { CashflowRowSchema, SpendingCategoryRowSchema, SummaryRowSchema, type CashflowGranularity, type CashflowRow, type SpendingCategoryRow, type SummaryRow } from "../domain/analytics.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { type AnalyticsPeriod } from "../application/ports/financial-data.js";
import { telemetry } from "../observability/telemetry.js";

export class AnalyticsRepository {
  constructor(private readonly client: SupabaseClient) {}

  obtenerResumen(filtro: AnalyticsPeriod): Promise<SummaryRow[]> {
    return this.ejecutar("get_financial_summary", parametros(filtro), SummaryRowSchema);
  }

  obtenerGastoPorCategoria(filtro: AnalyticsPeriod): Promise<SpendingCategoryRow[]> {
    return this.ejecutar("get_spending_by_category", parametros(filtro), SpendingCategoryRowSchema);
  }

  obtenerCashflow(filtro: AnalyticsPeriod & { granularity: CashflowGranularity }): Promise<CashflowRow[]> {
    return this.ejecutar("get_cashflow", { ...parametros(filtro), p_granularity: filtro.granularity }, CashflowRowSchema);
  }

  private async ejecutar<T>(funcion: string, params: Record<string, unknown>, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } } }): Promise<T[]> {
    const { data } = await telemetry.observe(
      { component: "supabase", operation: "rpc", queryName: funcion },
      async () => {
        const result = await this.client.rpc(funcion, params);
        if (result.error) throw mapearErrorSupabase(result.error, `rpc.${funcion}`);
        return result;
      },
      (result) => ({ resultCount: Array.isArray(result.data) ? result.data.length : 0 }),
    );

    if (!Array.isArray(data)) throw new RepositoryError(`Respuesta inválida de rpc.${funcion}`, "DATABASE_ERROR");
    return data.map((fila) => {
      const resultado = schema.safeParse(fila);
      if (!resultado.success) throw new RepositoryError(`Datos analíticos inválidos en rpc.${funcion}: ${resultado.error.message}`, "DATABASE_ERROR", resultado.error);
      return resultado.data;
    });
  }
}

function parametros(filtro: AnalyticsPeriod): Record<string, unknown> {
  return { p_user_id: filtro.userId, p_start_date: filtro.startDate, p_end_date: filtro.endDate, p_currency: filtro.currency ?? null };
}
