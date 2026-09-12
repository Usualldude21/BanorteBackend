import { z } from "zod";

/**
 * Schema de entrada para la herramienta ping.
 * El campo `mensaje` es opcional para que el agente pueda probar
 * el servidor sin necesidad de construir un payload complejo.
 */
export const PingInputSchema = z.object({
  mensaje: z
    .string()
    .max(200, "El mensaje no puede superar los 200 caracteres")
    .optional()
    .describe("Mensaje de prueba opcional"),
});

export type PingInput = z.infer<typeof PingInputSchema>;

/**
 * Schema de la respuesta de ping.
 * Tipo explícito para que otros módulos puedan depender de él.
 */
export const PingOutputSchema = z.object({
  estado: z.literal("ok"),
  servidorTimestamp: z.string(),
  mensajeEco: z.string().optional(),
  version: z.string(),
});

export type PingOutput = z.infer<typeof PingOutputSchema>;
