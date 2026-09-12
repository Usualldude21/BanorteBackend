import assert from "node:assert/strict";
import test from "node:test";
import { type UISpecification } from "@banorte/contracts";
import { createSharedUiPatches } from "../src/integration/shared-ui-stream.js";
import { ChallengeHarness, queryRequest } from "./support/challenge-harness.js";

const current: UISpecification = { version: "1", root: {
  type: "section", id: "root", ariaLabel: "Gastos", children: [
    { type: "heading", id: "period", level: 2, content: "Septiembre" },
    { type: "heading", id: "result", level: 3, content: "Resultado anterior" },
    { type: "input", id: "note", label: "Notas", event: "form.value.changed", validation: { maxLength: 500 } },
  ],
} };

test("L9 dos nodos modificados y título de contenedor no reemplazan la raíz ni la nota", () => {
  const next = structuredClone(current);
  if (next.root.type !== "section") throw new Error("section expected");
  next.root.ariaLabel = "Comparación";
  const [period, result] = next.root.children;
  if (period?.type !== "heading" || result?.type !== "heading") throw new Error("headings expected");
  period.content = "Agosto y septiembre";
  result.content = "Resultado actualizado";
  const patches = createSharedUiPatches(current, next, 4);
  assert.deepEqual(patches.map((patch) => [patch.op, patch.target]), [["update", "root"], ["update", "period"], ["update", "result"]]);
  assert.deepEqual(patches.map((patch) => [patch.baseRevision, patch.revision]), [[4, 5], [5, 6], [6, 7]]);
  assert.equal(createSharedUiPatches(current, current, 4).length, 0);
});

test("L9 elimina sólo el nodo solicitado; reordenar exige reemplazo seguro", () => {
  const next = structuredClone(current);
  if (next.root.type !== "section") throw new Error("section expected");
  next.root.children.splice(1, 1);
  assert.deepEqual(createSharedUiPatches(current, next, 7).map((patch) => [patch.op, patch.target]), [["remove", "result"]]);
  next.root.children.reverse();
  assert.equal(createSharedUiPatches(current, next, 7)[0]?.op, "replace");
});

test("L9 tres mensajes recuperan contexto de la misma sesión y encadenan revisiones", async () => {
  const harness = new ChallengeHarness();
  const sessionId = "48000000-0000-4000-8000-000000000001";
  const prompts = ["Quiero ahorrar $50,000 en 8 meses sin reducir salud y educación.", "Ahora puedo aportar $1,000 más al mes.", "Mantén el plazo de 8 meses y explica la simulación actual."];
  let previous;
  for (const [index, prompt] of prompts.entries()) {
    const events = await harness.run(queryRequest(sessionId, `49000000-0000-4000-8000-00000000000${index + 1}`, prompt, previous));
    assert.equal(events.some((event) => event.type === "error"), false);
    let revision = previous?.interfaceRevision ?? 0;
    for (const event of events) {
      if (event.type === "ui-started") revision = event.revision;
      if (event.type === "ui-patch") {
        assert.equal(event.patch.baseRevision, revision);
        revision = event.patch.revision;
      }
    }
    previous = harness.sessions.latest();
    assert.equal(previous.sessionId, sessionId);
    assert.equal(previous.interfaceRevision, revision);
  }
  assert.equal(harness.sessions.completions.length, 3);
  assert.match(harness.modelQueries.at(-1)!, /50,000/);
  assert.match(harness.modelQueries.at(-1)!, /1,000/);
  assert.ok(harness.toolCalls.every((call) => !call.name.includes("payment")));
});
