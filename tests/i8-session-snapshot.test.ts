import assert from "node:assert/strict";
import test from "node:test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { sessionUiSnapshotSchema, readSessionUiSnapshot } from "../src/integration/session-ui-snapshot.js";
import { SupabaseSessionStore } from "../src/repositories/supabase-session.repository.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const sessionId = "38000000-0000-4000-8000-000000000001";
const correlationId = "39000000-0000-4000-8000-000000000001";
const snapshot = {
  version: "1", sessionId, interfaceRevision: 3, dataRevision: 2, dataKeys: ["projection"],
  specification: { version: "1", root: { type: "text", id: "summary", content: "Simulación" } },
  data: { projection: { total: 9000 } }, invalidatedKeys: [],
};

test("I8 rechaza snapshot incompleto, invalidaciones inexistentes e identidad ajena", async () => {
  assert.equal(sessionUiSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(sessionUiSnapshotSchema.safeParse({ ...snapshot, data: {} }).success, false);
  assert.equal(sessionUiSnapshotSchema.safeParse({ ...snapshot, invalidatedKeys: ["missing"] }).success, false);
  const client = mockClient(async () => ({ data: [{ result_code: "success", snapshot: { ...snapshot, sessionId: correlationId } }], error: null }));
  await assert.rejects(readSessionUiSnapshot(client, sessionId));
});

test("I8 lectura no ejecuta Agent/MCP y no inventa datos cuando falta la migración", async () => {
  let calls = 0;
  const client = mockClient(async (name, parameters) => {
    calls += 1;
    assert.equal(name, "read_agent_session_snapshot");
    assert.deepEqual(parameters, { p_session_id: sessionId, p_correlation_id: null });
    return { data: null, error: { code: "PGRST202" } };
  });
  assert.deepEqual(await readSessionUiSnapshot(client, sessionId), { code: "snapshot_unavailable" });
  assert.equal(calls, 1);
});

test("I8 persiste con RPC atómica y restaura datos al crear otra instancia", async () => {
  let persisted: typeof snapshot | undefined;
  let atomicCalls = 0;
  const client = mockClient(async (name, parameters) => {
    if (name === "read_agent_session_snapshot") return { data: [{ result_code: persisted ? "success" : "snapshot_unavailable", snapshot: persisted ?? null }], error: null };
    if (name === "begin_agent_session") return { data: [{ result_code: "success", user_id: actorId, session_id: sessionId,
      interface_revision: persisted?.interfaceRevision ?? 0, data_revision: persisted?.dataRevision ?? 0,
      data_keys: persisted?.dataKeys ?? [], specification: persisted?.specification ?? null,
      turns: [], interaction_state: {}, financial_constraints: { revision: 0, protectedExpenseCategories: [] }, pending_payment_intent_id: null }], error: null };
    assert.equal(name, "complete_agent_session_snapshot");
    atomicCalls += 1;
    assert.deepEqual(parameters.p_data_registry, snapshot.data);
    persisted = structuredClone(snapshot);
    return { data: [{ result_code: "success" }], error: null };
  });
  const first = new SupabaseSessionStore(client);
  await first.begin({ actorId, sessionId, correlationId });
  await first.complete({ actorId, sessionId, correlationId,
    interfaceRevision: 3, dataRevision: 2, dataKeys: snapshot.dataKeys,
    specification: sessionUiSnapshotSchema.parse(snapshot).specification,
    dataRegistry: snapshot.data, invalidatedKeys: [], answer: "" });
  const next = await new SupabaseSessionStore(client).begin({ actorId, sessionId, correlationId,
    reference: { interfaceRevision: 3, dataRevision: 2, dataKeys: snapshot.dataKeys } });
  assert.equal(next.success, true);
  if (next.success) assert.deepEqual(next.state.dataRegistry, snapshot.data);
  assert.equal(atomicCalls, 1);
});

function mockClient(rpc: (name: string, parameters: Record<string, unknown>) => Promise<unknown>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}
