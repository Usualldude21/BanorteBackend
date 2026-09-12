import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./config/logger.js";
import { crearServidor } from "./server.js";
import { createAuthenticatedSupabaseSession } from "./config/supabase.js";

async function main(): Promise<void> {
  const session = await createAuthenticatedSupabaseSession();
  const server = crearServidor(session);

  const transporte = new StdioServerTransport();

  await server.connect(transporte);

  logger.info("Servidor MCP iniciado (transporte: stdio)");

  process.on("SIGINT", async () => {
    logger.info("Señal SIGINT recibida — cerrando servidor");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Señal SIGTERM recibida — cerrando servidor");
    await server.close();
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  // stderr para no corromper el canal stdio
  process.stderr.write(`[fatal] Error al iniciar el servidor: ${mensaje}\n`);
  process.exit(1);
});
