import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { createSystemApi } from "./system-api.js";

const server = createSystemApi();

server.on("error", (error) => {
  logger.error("Agent API no pudo iniciarse", {
    code: "code" in error ? String(error.code) : "unknown",
  });
  process.exitCode = 1;
});

server.listen(env.AGENT_API_PORT, env.AGENT_API_HOST, () => {
  logger.info("Agent API disponible", {
    host: env.AGENT_API_HOST,
    port: env.AGENT_API_PORT,
  });
});

function closeServer(signal: string): void {
  logger.info("Cerrando Agent API", { signal });
  server.close((error) => {
    if (error) {
      logger.error("No fue posible cerrar Agent API", { errorType: error.name });
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => closeServer("SIGINT"));
process.on("SIGTERM", () => closeServer("SIGTERM"));
