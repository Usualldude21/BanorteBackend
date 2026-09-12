import { once } from "node:events";
import { AgentQuerySchema } from "../schemas/agent.schema.js";
import { serializeAgentStreamEvent } from "../stream/agent-stream.schema.js";
import { AgentStreamSession } from "../stream/agent-stream-session.js";
import { createAgentRuntime, type SessionFactory } from "./agent-runtime.js";
import { paymentWritePermissionsForQuery } from "../payment-write-policy.js";

export async function runAgentStreamCli(sessionFactory: SessionFactory): Promise<void> {
  const query = AgentQuerySchema.parse(process.argv.slice(2).join(" "));
  const runtime = await createAgentRuntime(sessionFactory, {
    paymentWritePermissions: paymentWritePermissionsForQuery(query),
  });
  const stream = new AgentStreamSession(runtime.orchestrator, query);
  const cancel = () => stream.cancel();
  process.once("SIGINT", cancel);

  try {
    while (true) {
      const result = await stream.next();
      if (result.done) break;
      const event = result.value;
      await writeWithBackpressure(serializeAgentStreamEvent(event));
      if (event.type === "error") process.exitCode = 1;
      if (event.type === "cancelled") process.exitCode = 130;
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    await stream.close();
    await runtime.close();
  }
}

async function writeWithBackpressure(value: string): Promise<void> {
  if (process.stdout.write(value)) return;
  await once(process.stdout, "drain");
}
