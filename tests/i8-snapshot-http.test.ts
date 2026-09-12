import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { type AuthenticatedSupabaseSession } from "../src/config/supabase.js";
import { createSystemApi } from "../src/http/system-api.js";

test("I8 endpoint snapshot exige identidad individual y nunca ejecuta Agent", async () => {
  const sessionId = "38000000-0000-4000-8000-000000000001";
  const snapshot = { version: "1", sessionId, interfaceRevision: 5, dataRevision: 8,
    dataKeys: ["projection"], data: { projection: { total: 9000 } }, invalidatedKeys: [],
    specification: { version: "1", root: { type: "text", id: "summary", content: "Simulación" } } };
  let reads = 0;
  const server = createSystemApi({ apiToken: "legacy-api-token-not-a-user-identity",
    textAgent: async function* () { throw new Error("Snapshot no debe llamar Agent"); },
    createUserSession: async () => ({ user: { id: "10000000-0000-4000-8000-000000000001" },
      client: { rpc: async (name: string) => {
        assert.equal(name, "read_agent_session_snapshot"); reads += 1;
        return { data: [{ result_code: "success", snapshot }], error: null };
      } } } as unknown as AuthenticatedSupabaseSession),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/snapshot`;
  try {
    const unauthorized = await fetch(url, { method: "POST", body: JSON.stringify({ sessionId }) });
    assert.equal(unauthorized.status, 401);
    assert.equal(reads, 0);
    const authorized = await fetch(url, { method: "POST", headers: {
      Authorization: "Bearer individual-user-access-token-long-enough", "Content-Type": "application/json",
    }, body: JSON.stringify({ sessionId }) });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), snapshot);
    assert.equal(reads, 1);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
