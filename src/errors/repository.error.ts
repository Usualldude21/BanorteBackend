/**
 * Error de repositorio: encapsula cualquier fallo de la capa de acceso a datos.
 *
 * Por qué existe esta clase:
 * - Los servicios y herramientas MCP no deben depender de los tipos de error
 *   específicos de Supabase (PostgrestError, etc.).
 * - Si en el futuro se cambia Supabase por otra fuente de datos, solo cambia
 *   el repositorio, no los servicios.
 * - Permite distinguir errores de "no encontrado" de errores de infraestructura
 *   sin comparar strings de mensajes.
 */
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly causa?: unknown;

  constructor(mensaje: string, code: RepositoryErrorCode, causa?: unknown) {
    super(mensaje);
    this.name = "RepositoryError";
    this.code = code;
    this.causa = causa;
  }
}

export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "INSUFFICIENT_FUNDS"
  | "DATABASE_ERROR"
  | "UNAUTHORIZED";

/**
 * Convierte un error de Supabase/PostgrestError en un RepositoryError tipado.
 * Centraliza la lógica de mapeo en un solo lugar.
 */
export function mapearErrorSupabase(
  error: unknown,
  contexto: string,
): RepositoryError {
  if (error instanceof RepositoryError) {
    return error;
  }

  // PostgrestError tiene el campo `code` con el código de error de Postgres
  if (isPostgrestError(error)) {
    // 23505 = unique_violation (conflicto de unicidad)
    if (error.code === "23505") {
      return new RepositoryError(
        `Conflicto de unicidad en ${contexto}`,
        "CONFLICT",
        error,
      );
    }

    // PGRST116 = no rows returned (not found en Supabase)
    if (error.code === "PGRST116") {
      return new RepositoryError(
        `Registro no encontrado en ${contexto}`,
        "NOT_FOUND",
        error,
      );
    }

    if (error.code === "42501") {
      return new RepositoryError(`Acceso no autorizado en ${contexto}`, "UNAUTHORIZED", error);
    }
    if (error.code === "P0002") {
      return new RepositoryError(`Recurso no encontrado en ${contexto}`, "NOT_FOUND", error);
    }
    if (error.code === "P0001" && /^insufficient funds$/iu.test(error.message.trim())) {
      return new RepositoryError(`Saldo insuficiente en ${contexto}`, "INSUFFICIENT_FUNDS", error);
    }
    if (error.code === "22023" || error.code === "23514" || error.code === "P0001") {
      return new RepositoryError(`Entrada o estado inválido en ${contexto}`, "INVALID_INPUT", error);
    }

    return new RepositoryError(
      `Error de base de datos en ${contexto}: ${error.message}`,
      "DATABASE_ERROR",
      error,
    );
  }

  return new RepositoryError(
    `Error inesperado en ${contexto}`,
    "DATABASE_ERROR",
    error,
  );
}

interface PostgrestError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
