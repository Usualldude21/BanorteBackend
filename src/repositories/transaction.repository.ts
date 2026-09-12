import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../config/logger.js";
import {
  TransactionSchema,
  type Transaction,
  type TransactionFilter,
} from "../domain/transaction.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";

const TABLA = "transactions";

export class TransactionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async obtenerPorFiltro(filtro: TransactionFilter): Promise<Transaction[]> {
    logger.debug("Consultando transacciones");

    let query = this.client
      .from(TABLA)
      .select(
        "id,account_id,user_id,type,amount,currency,description,category,reference_id,transaction_date,created_at",
      )
      .eq("user_id", filtro.user_id);

    if (filtro.account_id !== undefined) {
      query = query.eq("account_id", filtro.account_id);
    }

    if (filtro.type !== undefined) {
      query = query.eq("type", filtro.type);
    }

    if (filtro.category !== undefined) {
      query = query.eq("category", filtro.category);
    }

    if (filtro.start_date !== undefined) {
      query = query.gte("transaction_date", filtro.start_date);
    }

    if (filtro.end_date !== undefined) {
      query = query.lte("transaction_date", filtro.end_date);
    }

    query = query
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(filtro.offset, filtro.offset + filtro.limit);

    const { data } = await telemetry.observe(
      { component: "supabase", operation: "query", queryName: "transactions.list" },
      async () => {
        const result = await query;
        if (result.error) {
          throw mapearErrorSupabase(result.error, `${TABLA}.obtenerPorFiltro`);
        }
        return result;
      },
      (result) => ({ resultCount: result.data?.length ?? 0 }),
    );

    return parsearFilas(data ?? [], `${TABLA}.obtenerPorFiltro`);
  }
}

function parsearFila(fila: unknown, contexto: string): Transaction {
  const resultado = TransactionSchema.safeParse(fila);

  if (!resultado.success) {
    throw new RepositoryError(
      `Datos de transacción inválidos desde la BD en ${contexto}: ${resultado.error.message}`,
      "DATABASE_ERROR",
      resultado.error,
    );
  }

  return resultado.data;
}

function parsearFilas(filas: unknown[], contexto: string): Transaction[] {
  return filas.map((fila) => parsearFila(fila, contexto));
}
