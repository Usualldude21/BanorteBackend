import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { type PingInput, type PingOutput } from "../schemas/ping.schema.js";

export function ejecutarPing(input: PingInput): PingOutput {
  logger.debug("Ejecutando ping");

  const respuesta: PingOutput = {
    estado: "ok",
    servidorTimestamp: new Date().toISOString(),
    version: env.MCP_SERVER_VERSION,
    ...(input.mensaje !== undefined
      ? { mensajeEco: input.mensaje }
      : {}),
  };

  logger.info("Ping ejecutado con éxito");
  return respuesta;
}
