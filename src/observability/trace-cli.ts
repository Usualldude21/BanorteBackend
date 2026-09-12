import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { filterTraceLine, InvalidTraceRequestError } from "./trace-filter.js";

async function main(): Promise<void> {
  const [requestId, logPath] = process.argv.slice(2);
  if (!requestId || !logPath) {
    throw new TraceCliError("Uso: pnpm trace <requestId> <archivo-jsonl>");
  }

  const lines = createInterface({
    input: createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let matches = 0;
  for await (const line of lines) {
    const match = filterTraceLine(line, requestId);
    if (!match) continue;
    process.stdout.write(`${match}\n`);
    matches += 1;
  }
  if (matches === 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof TraceCliError || error instanceof InvalidTraceRequestError
    ? error.message
    : "No fue posible leer la traza";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

class TraceCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceCliError";
  }
}
