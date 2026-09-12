import assert from "node:assert/strict";
import test from "node:test";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const query = "Quiero ahorrar $40,000 en 10 meses para gastos escolares. Simula con tasa cero y genera un control para ajustar mi aportación mensual, una tabla de evolución y un campo de notas. Al ajustar el importe, actualiza sólo la simulación y conserva la nota que esté escribiendo.";
const sources: UiDataSource[] = [{ id: "source-1", toolName: "simulate_savings", data: {
  projectedBalance: "40000.00", timeline: [{ period: 1, balance: "4000.00" }],
} }];
const document = parseUiDocument({ version: "1.0", root: { type: "stack", id: "savings", direction: "vertical", children: [
  { type: "slider", id: "contribution", label: "Aportación mensual", min: 0, max: 10000, step: 100, initialValue: 4000, showValue: true },
  { type: "table", id: "timeline", title: "Evolución mensual", data: { sourceId: "source-1", path: "timeline" }, columns: [{ key: "period", label: "Mes" }, { key: "balance", label: "Acumulado" }], maxRows: 10 },
  { type: "form", id: "notes", title: "Notas", fields: [{ type: "text", id: "note", label: "Nota", maxLength: 500 }], submitLabel: "Guardar nota" },
] } }, sources);

test("I8 tabla de evolución no obliga a generar una gráfica adicional", () => {
  assert.deepEqual(validateUiSemantics(query, document, sources), { success: true, issues: [] });
});

test("I8 mantiene obligatorios tabla, control de aportación y notas pedidos", () => {
  if (document.root.type !== "stack") throw new Error("Expected stack");
  for (const [type, code] of [["table", "table_required"], ["slider", "slider_required"], ["form", "notes_field_required"]]) {
    const result = validateUiSemantics(query, { ...document, root: { ...document.root, children: document.root.children.filter((node) => node.type !== type) } }, sources);
    assert.equal(result.success, false);
    assert.ok(result.issues.some((issue) => issue.code === code), code);
  }
});

test("I8 sigue exigiendo una gráfica cuando el usuario también la pide y respeta exclusiones", () => {
  const chartRequired = validateUiSemantics(query + " Incluye además una gráfica.", document, sources);
  assert.ok(chartRequired.issues.some((issue) => issue.code === "chart_required"));
  assert.equal(validateUiSemantics(query + " Sin gráficas.", document, sources).success, true);
  const tablesForbidden = validateUiSemantics("Muestra la evolución sin tablas.", document, sources);
  assert.ok(tablesForbidden.issues.some((issue) => issue.code === "table_forbidden"));
});

test("I8 instrucciones generales de UIEvent no convierten una mención de gráficas en requisito", () => {
  assert.equal(validateUiSemantics(
    "Respeta las preferencias de presentación de la solicitud original, como evitar tablas, gráficas o resúmenes. " + query,
    document, sources,
  ).success, true);
});

test("L9 retirar tablas en un seguimiento invalida una composición que todavía las incluye", () => {
  for (const request of ["Compáralo con el mes pasado y quita la tabla.", "Quita todas las tablas.", "Elimina las tablas.", "Retira la tabla."]) {
    const result = validateUiSemantics(request, document, sources);
    assert.equal(result.success, false);
    assert.ok(result.issues.some((issue) => issue.code === "table_forbidden"), request);
  }
  assert.ok(!validateUiSemantics("No quites la tabla.", document, sources).issues.some((issue) => issue.code === "table_forbidden"));
});
