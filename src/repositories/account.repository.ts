import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../config/logger.js";
import { AccountSchema, type Account, type AccountFilter } from "../domain/account.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";

const TABLA = "accounts";
const ACCOUNT_RESULT_LIMIT = 100;

export class AccountRepository {
  constructor(private readonly client: SupabaseClient) {}

  async obtenerPorUsuario(filtro: AccountFilter): Promise<Account[]> {
    logger.debug("Consultando cuentas por usuario");

    let query = this.client
      .from(TABLA)
      .select("id,user_id,type,status,name,currency,balance,masked_identifier,created_at,updated_at")
      .eq("user_id", filtro.user_id);

    if (filtro.type !== undefined) {
      query = query.eq("type", filtro.type);
    }

    if (filtro.status !== undefined) {
      query = query.eq("status", filtro.status);
    }

    if (filtro.currency !== undefined) {
      query = query.eq("currency", filtro.currency);
    }

    const { data } = await telemetry.observe(
      { component: "supabase", operation: "query", queryName: "accounts.list" },
      async () => {
        const result = await query
          .order("created_at", { ascending: false })
          .range(0, ACCOUNT_RESULT_LIMIT);
        if (result.error) {
          throw mapearErrorSupabase(result.error, `${TABLA}.obtenerPorUsuario`);
        }
        return result;
      },
      (result) => ({ resultCount: result.data?.length ?? 0 }),
    );

    if ((data?.length ?? 0) > ACCOUNT_RESULT_LIMIT) {
      throw new RepositoryError(
        `La consulta supera el máximo de ${ACCOUNT_RESULT_LIMIT} cuentas`,
        "INVALID_INPUT",
      );
    }

    return parsearFilas(data ?? [], `${TABLA}.obtenerPorUsuario`);
  }

  async obtenerPorId(id: string, userId: string): Promise<Account> {
    logger.debug("Consultando cuenta por id");

    const { data } = await telemetry.observe(
      { component: "supabase", operation: "query", queryName: "accounts.get-by-id" },
      async () => {
        const result = await this.client
          .from(TABLA)
          .select("id,user_id,type,status,name,currency,balance,masked_identifier,created_at,updated_at")
          .eq("id", id)
          .eq("user_id", userId)
          .single();
        if (result.error) {
          throw mapearErrorSupabase(result.error, `${TABLA}.obtenerPorId`);
        }
        return result;
      },
      (result) => ({ resultCount: result.data ? 1 : 0 }),
    );

    if (!data) {
      throw new RepositoryError(
        `Cuenta ${id} no encontrada para el usuario ${userId}`,
        "NOT_FOUND",
      );
    }

    return parsearFila(data, `${TABLA}.obtenerPorId`);
  }
}

function parsearFila(fila: unknown, contexto: string): Account {
  const resultado = AccountSchema.safeParse(fila);

  if (!resultado.success) {
    throw new RepositoryError(
      `Datos de cuenta inválidos desde la BD en ${contexto}: ${resultado.error.message}`,
      "DATABASE_ERROR",
      resultado.error,
    );
  }

  return resultado.data;
}

function parsearFilas(filas: unknown[], contexto: string): Account[] {
  return filas.map((fila) => parsearFila(fila, contexto));
}
