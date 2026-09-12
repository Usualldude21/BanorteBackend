import { z } from "zod";
import { FinancialCategorySchema, TransactionTypeSchema, TRANSACTION_LIMIT_MAX, TRANSACTION_LIMIT_DEFAULT, TRANSACTION_DATE_RANGE_MAX_DAYS } from "../domain/transaction.js";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const FechaISOSchema = z
  .string()
  .regex(ISO_DATE_REGEX, "La fecha debe tener formato YYYY-MM-DD")
  .refine(esFechaCalendarioValida, "La fecha no es válida");

function esFechaCalendarioValida(valor: string): boolean {
  const partes = ISO_DATE_REGEX.exec(valor);
  if (!partes) return false;

  const [anio, mes, dia] = valor.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

export const GetTransactionsToolInputSchema = z.object({
    accountId: z
      .string()
      .uuid("accountId debe ser un UUID válido")
      .optional()
      .describe("Filtrar por cuenta específica. Omite para obtener todas las cuentas del usuario."),

    startDate: FechaISOSchema.optional().describe(
      "Fecha de inicio del rango (YYYY-MM-DD, inclusiva)",
    ),

    endDate: FechaISOSchema.optional().describe(
      "Fecha de fin del rango (YYYY-MM-DD, inclusiva)",
    ),

    category: FinancialCategorySchema
      .optional()
      .describe("Filtrar por categoría. Búsqueda exacta."),

    transactionType: TransactionTypeSchema.optional().describe(
      "Filtrar por tipo: income | expense | transfer | payment",
    ),

    limit: z
      .number()
      .int("limit debe ser un entero")
      .min(1, "limit debe ser al menos 1")
      .max(TRANSACTION_LIMIT_MAX, `El máximo de resultados por página es ${TRANSACTION_LIMIT_MAX}`)
      .default(TRANSACTION_LIMIT_DEFAULT)
      .describe(`Número de resultados por página. Máximo: ${TRANSACTION_LIMIT_MAX}. Por defecto: ${TRANSACTION_LIMIT_DEFAULT}.`),

    offset: z
      .number()
      .int("offset debe ser un entero")
      .min(0, "offset debe ser mayor o igual a 0")
      .max(10_000, "offset no puede superar 10000")
      .default(0)
      .describe("Número de resultados a omitir para paginación"),
  });

export const GetTransactionsInputSchema = GetTransactionsToolInputSchema.superRefine((data, ctx) => {
    if (data.startDate && data.endDate) {
      const inicio = new Date(data.startDate);
      const fin = new Date(data.endDate);

      if (inicio > fin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "startDate no puede ser posterior a endDate",
        });
      }

      const diasDiferencia =
        (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24) + 1;

      if (diasDiferencia > TRANSACTION_DATE_RANGE_MAX_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: `El rango de fechas no puede superar ${TRANSACTION_DATE_RANGE_MAX_DAYS} días`,
        });
      }
    }
  });

export type GetTransactionsInput = z.infer<typeof GetTransactionsInputSchema>;

/**
 * Proyección pública de una transacción para el agente.
 * Excluye: user_id (redundante), created_at (no útil para el agente), reference_id.
 */
export const TransactionProjectionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  type: TransactionTypeSchema,
  amount: z.string().describe("Importe en formato decimal string. Siempre positivo."),
  currency: z.string(),
  description: z.string(),
  category: z.string(),
  transactionDate: z.string().describe("Fecha contable YYYY-MM-DD"),
});

export type TransactionProjection = z.infer<typeof TransactionProjectionSchema>;

export const GetTransactionsOutputSchema = z.object({
  transactions: z.array(TransactionProjectionSchema),
  pagination: z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    returned: z.number().int(),
    hasMore: z.boolean().describe("Indica si hay más resultados pasando offset + limit"),
  }),
  metadata: z.object({
    queriedAt: z.string().datetime(),
    appliedFilters: z.object({
      accountId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      category: z.string().optional(),
      transactionType: z.string().optional(),
    }),
  }),
});

export type GetTransactionsOutput = z.infer<typeof GetTransactionsOutputSchema>;
