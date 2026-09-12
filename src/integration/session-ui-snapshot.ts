import { dataRegistrySchema, sessionReferenceSchema, uiSpecificationSchema } from "@banorte/contracts";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const sessionUiSnapshotSchema = sessionReferenceSchema.extend({
  version: z.literal("1"),
  sessionId: z.string().uuid(),
  specification: uiSpecificationSchema,
  data: dataRegistrySchema,
  invalidatedKeys: z.array(z.string().min(1).max(64)).max(20),
}).strict().superRefine((snapshot, context) => {
  const keys = Object.keys(snapshot.data).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...snapshot.dataKeys].sort())
    || snapshot.invalidatedKeys.some((key) => !Object.hasOwn(snapshot.data, key))) {
    context.addIssue({ code: "custom", message: "Snapshot de datos incompleto" });
  }
});

export function isMissingSnapshotRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export async function readSessionUiSnapshot(client: SupabaseClient, sessionId: string, correlationId?: string) {
  const result = await client.rpc("read_agent_session_snapshot", {
    p_session_id: sessionId, p_correlation_id: correlationId ?? null,
  });
  if (isMissingSnapshotRpc(result.error)) return { code: "snapshot_unavailable" as const };
  if (result.error) throw new Error("No fue posible leer el snapshot");
  const row = z.object({ result_code: z.enum([
    "success", "session_not_found", "session_forbidden", "session_busy", "snapshot_unavailable",
  ]), snapshot: z.unknown().nullable() }).parse(Array.isArray(result.data) ? result.data[0] : undefined);
  if (row.result_code !== "success") return { code: row.result_code };
  const snapshot = sessionUiSnapshotSchema.parse(row.snapshot);
  if (snapshot.sessionId !== sessionId) throw new Error("Identidad de snapshot inválida");
  return { code: "success" as const, snapshot };
}
