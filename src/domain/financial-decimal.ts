import { z } from "zod";

const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;
const DATABASE_NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const MAX_SAFE_DECIMAL = Number.MAX_SAFE_INTEGER / 100;

const SafeNumericDecimalSchema = z
  .number()
  .finite()
  .refine(
    (value) => Math.abs(value) <= MAX_SAFE_DECIMAL && Number(value.toFixed(2)) === value,
    "El importe numérico debe conservar precisión exacta hasta centavos",
  )
  .transform((value) => value.toFixed(2));

export const FinancialDecimalSchema = z.union([
  z.string().regex(DECIMAL_PATTERN, "Importe con formato numérico inválido"),
  SafeNumericDecimalSchema,
]);

export const PositiveFinancialDecimalSchema = FinancialDecimalSchema.refine(
  (value) => Number(value) > 0,
  "El importe debe ser positivo",
);

export const DatabaseNumericSchema = z.union([
  z.string().regex(DATABASE_NUMERIC_PATTERN, "Valor numeric inválido"),
  z
    .number()
    .finite()
    .refine(
      (value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER,
      "El valor numeric supera el rango seguro",
    )
    .transform((value) => value.toString()),
]);
