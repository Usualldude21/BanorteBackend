import { type SupabaseClient } from "@supabase/supabase-js";
import {
  ANOMALY_QUERY_MAX_ROWS,
  AnomalyTransactionSchema,
  type AnomalyFilter,
  type AnomalyTransaction,
} from "../domain/anomaly.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";

export class AnomalyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async obtenerMuestra(filter: AnomalyFilter): Promise<AnomalyTransaction[]> {
    let query = this.client
      .from("transactions")
      .select("id,account_id,type,amount,currency,category,transaction_date")
      .eq("user_id", filter.userId)
      .gte("transaction_date", filter.startDate)
      .lte("transaction_date", filter.endDate);

    if (filter.accountId) query = query.eq("account_id", filter.accountId);
    if (filter.category) query = query.eq("category", filter.category);
    if (filter.transactionType) query = query.eq("type", filter.transactionType);
    if (filter.currency) query = query.eq("currency", filter.currency);

    const { data } = await telemetry.observe(
      { component: "supabase", operation: "query", queryName: "transactions.anomaly-sample" },
      async () => {
        const result = await query
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: false })
          .range(0, ANOMALY_QUERY_MAX_ROWS);
        if (result.error) {
          throw mapearErrorSupabase(result.error, "transactions.obtenerMuestraAnomalias");
        }
        return result;
      },
      (result) => ({ resultCount: Array.isArray(result.data) ? result.data.length : 0 }),
    );
    if (!Array.isArray(data)) throw new RepositoryError("Respuesta inválida al consultar transacciones", "DATABASE_ERROR");
    if (data.length > ANOMALY_QUERY_MAX_ROWS) {
      throw new RepositoryError(
        `La consulta supera el máximo de ${ANOMALY_QUERY_MAX_ROWS} transacciones`,
        "INVALID_INPUT",
      );
    }

    return data.map((row) => {
      const result = AnomalyTransactionSchema.safeParse(row);
      if (!result.success) {
        throw new RepositoryError("Datos inválidos al analizar transacciones", "DATABASE_ERROR", result.error);
      }
      return result.data;
    });
  }
}
