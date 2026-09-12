import assert from "node:assert/strict";
import test from "node:test";
import { type TextAgentStreamEvent } from "@banorte/contracts";
import { ChallengeHarness, interactionRequest, queryRequest } from "./support/challenge-harness.js";

test("I8 mantiene secuencias UI/datos independientes y ordenadas entre turnos", async () => {
  const harness = new ChallengeHarness();
  const sessionId = "38000000-0000-4000-8000-000000000001";
  const first = await harness.run(queryRequest(sessionId,
    "39000000-0000-4000-8000-000000000001",
    "Quiero ahorrar $50,000 en 8 meses sin reducir gastos de salud y educación. ¿Qué aportación mensual necesito?"));
  const initial = harness.sessions.latest();
  assertSequence(first, 0, 0);
  const next = await harness.run(interactionRequest(sessionId,
    "39000000-0000-4000-8000-000000000002", initial,
    { name: "simulation.changed", sourceId: "monthly-saving", value: 8000 }));
  assertSequence(next, initial.interfaceRevision, initial.dataRevision);
  const completed = harness.sessions.latest();
  const replayed: Record<string, unknown> = {};
  const invalidated = new Set<string>();
  for (const event of [...first, ...next]) {
    if (event.type === "data-patch") {
      if ("value" in event.patch) { replayed[event.patch.key] = event.patch.value; invalidated.delete(event.patch.key); }
      if (event.patch.op === "invalidate") invalidated.add(event.patch.key);
      if (event.patch.op === "remove") { delete replayed[event.patch.key]; invalidated.delete(event.patch.key); }
    } else if (event.type === "ui" || event.type === "ui-started") {
      Object.assign(replayed, event.dataRegistry.data);
    }
  }
  assert.deepEqual(completed.dataRegistry, replayed);
  assert.deepEqual([...(completed.invalidatedKeys ?? [])].sort(), [...invalidated].sort());
  assert.ok(completed.interfaceRevision > initial.interfaceRevision);
  assert.ok(completed.dataRevision > initial.dataRevision);
  const callsBefore = harness.toolCalls.length;
  const stale = await harness.run(interactionRequest(sessionId,
    "39000000-0000-4000-8000-000000000003", initial,
    { name: "simulation.changed", sourceId: "monthly-saving", value: 7500 }));
  assert.ok(stale.some((event) => event.type === "error" && event.error.code === "session_revision_conflict"));
  assert.equal(harness.toolCalls.length, callsBefore);
  assert.deepEqual(harness.sessions.latest(), completed);
});

function assertSequence(events: TextAgentStreamEvent[], uiRevision: number, dataRevision: number): void {
  assert.equal(events.some((event) => event.type === "error"), false);
  let patches = 0;
  for (const event of events) {
    if (event.type === "data-patch") {
      assert.equal(event.patch.baseRevision, dataRevision);
      dataRevision = event.patch.revision;
      patches += 1;
    } else if (event.type === "ui-started") {
      assert.ok(patches > 0);
      uiRevision = event.revision;
    } else if (event.type === "ui-patch") {
      assert.equal(event.patch.baseRevision, uiRevision);
      uiRevision = event.patch.revision;
    } else if (event.type === "ui-completed") {
      assert.equal(event.revision, uiRevision);
    }
  }
  assert.ok(patches > 1, "debe comprobar varios patches del mismo turno");
}
