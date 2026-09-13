import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeHarness, queryRequest } from "./support/challenge-harness.js";
import { createProvisionalUiPayload } from "../src/integration/shared-ui-stream.js";

test("I6 emite DataPatch antes de la primera UI que consume sus bindings", async () => {
  const harness = new ChallengeHarness();
  const events = await harness.run(queryRequest(
    "33000000-0000-4000-8000-000000000001",
    "44000000-0000-4000-8000-000000000001",
    "¿En qué se me está yendo el dinero?",
  ));
  const dataIndex = events.findIndex((event) => event.type === "data-patch");
  const uiIndex = events.findIndex((event) => event.type === "ui-started" || event.type === "ui");
  const completedIndex = events.findIndex((event) => event.type === "ui-completed");

  assert.ok(dataIndex >= 0, "debe existir un DataPatch");
  assert.ok(uiIndex > dataIndex, "la UI inicial debe llegar después de sus datos");
  assert.ok(completedIndex > uiIndex, "la primera UI útil debe preceder al cierre");
  assert.ok(events.slice(uiIndex + 1, completedIndex).some((event) => event.type === "ui-patch"));

  const initialUI = events[uiIndex];
  assert.ok(initialUI?.type === "ui-started" || initialUI?.type === "ui");
  const table = findTable(initialUI.specification.root);
  assert.ok(table && table.type === "table");
  assert.equal(table.columns.find((column) => column.field === "amount")?.format, "currency");
  assert.equal(table.columns.find((column) => column.field === "percentage")?.format, "percentage");
  assert.equal(table.columns.find((column) => (
    column.field === "transaction_count" || column.field === "transactionCount"
  ))?.label, "Transacciones");
});

test("BP6.5 evita una tabla provisional que sólo muestre la moneda", () => {
  const preview = createProvisionalUiPayload({
    id: "source-1", toolName: "compare_periods", data: {
      comparisons: [{ currency: "MXN", expenses: { previousValue: "20650.00", currentValue: "27600.00" } }],
      dataType: "OBSERVED",
    },
  }, 1);
  assert.equal(preview, null);
});

function findTable(node: unknown): { type: "table"; columns: Array<{ field: string; label: string; format?: string }> } | undefined {
  if (!node || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  if (record.type === "table" && Array.isArray(record.columns)) {
    return record as ReturnType<typeof findTable>;
  }
  if (!Array.isArray(record.children)) return undefined;
  return record.children.map(findTable).find((candidate) => candidate !== undefined);
}
