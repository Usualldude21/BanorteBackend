import assert from "node:assert/strict";
import test from "node:test";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const sources: UiDataSource[] = [{ id: "source-1", toolName: "evaluate_financial_health", data: { score: 39 } }];
const metricsOnly = parseUiDocument({ version: "1.0", root: { type: "stack", id: "education", direction: "vertical", children: [
  { type: "metric", id: "score", label: "Salud", value: { sourceId: "source-1", path: "score" }, format: "number" },
] } }, sources);

test("L10 una educación solicitada no se aprueba como métricas sin explicación", () => {
  const result = validateUiSemantics("¿Por qué no logro ahorrar?", metricsOnly, sources);
  assert.ok(result.issues.some((issue) => issue.code === "education_guidance_required"));
  if (metricsOnly.root.type !== "stack") throw new Error("stack expected");
  const explained = parseUiDocument({ ...metricsOnly, root: { ...metricsOnly.root, children: [...metricsOnly.root.children,
    { type: "text", id: "guidance", text: "RECOMMENDED: ajusta sólo categorías flexibles; renta y transporte son intocables.", variant: "body" },
  ] } }, sources);
  assert.equal(validateUiSemantics("Vuelve a recomendar ajustes.", explained, sources).success, true);
});

test("L10 una solicitud de pago no hereda la obligación educativa anterior", () => {
  assert.equal(validateUiSemantics("Contexto: ¿Por qué no logro ahorrar? Nueva solicitud del usuario: Prepara un pago para revisión.", metricsOnly, sources).success, true);
});

test("L10 conserva explicación al declarar gastos intocables", () => {
  const result = validateUiSemantics("No puedo reducir renta ni transporte", metricsOnly, sources);
  assert.ok(result.issues.some((issue) => issue.code === "education_guidance_required"));
});

function narrative(text: string, dataSources: UiDataSource[]) {
  return parseUiDocument({ version: "1.0", root: { type: "text", id: "payment-note", text, variant: "body" } }, dataSources);
}

test("L10 el saldo de tarjeta no acredita amortización ni deuda", () => {
  const accounts: UiDataSource[] = [{ id: "accounts", toolName: "get_accounts", data: { accounts: [{ type: "credit", balance: "8400" }] } }];
  const result = validateUiSemantics("Prepara un pago", narrative("Abonar $500 disminuye la deuda restante a $7900.", accounts), accounts);
  assert.ok(result.issues.some((issue) => issue.code === "payment_debt_unverified"));
  assert.ok(validateUiSemantics("Prepara un pago", narrative("El saldo de la tarjeta de crédito se reduciría a $7900.", accounts), accounts).issues.some((issue) => issue.code === "payment_debt_unverified"));
  assert.equal(validateUiSemantics("Prepara un pago", narrative("No se puede calcular amortización sin deuda comprobada. SIMULATED: sólo revisión, no dinero movido.", accounts), accounts).success, true);
});

test("L10 importes protegidos requieren evidencia de su categoría, no historia", () => {
  const spending: UiDataSource[] = [{ id: "spending", toolName: "get_spending_by_category", data: { categories: [
    { category: "housing", amount: "8500.00" }, { category: "transport", amount: "2400.00" },
  ] } }];
  assert.equal(validateUiSemantics("Prepara un pago", narrative("OBSERVED: vivienda $8,500 y transporte $2,400 permanecen intocables.", spending), spending).success, true);
  for (const data of [spending, []]) {
    const result = validateUiSemantics("Prepara un pago", narrative("Renta $12,000 y transporte $3,500 intocables.", data), data);
    assert.ok(result.issues.some((issue) => issue.code === "payment_category_amount_unverified"));
  }
  assert.equal(validateUiSemantics("Prepara un pago", narrative("Renta y transporte permanecen intocables; falta evidencia de sus importes.", []), []).success, true);
});

test("L10 no modifica la validación de recibos confirmados", () => {
  const receipt: UiDataSource[] = [{ id: "receipt", toolName: "confirm_payment", data: { status: "completed" } }];
  assert.equal(validateUiSemantics("Consulta mi pago", narrative("Pago confirmado.", receipt), receipt).success, true);
});

test("L10 el efecto hipotético del pago sobre margen se etiqueta SIMULATED", () => {
  const text = "El margen quedaría en $1900 tras el pago.";
  assert.ok(validateUiSemantics("Prepara un pago", narrative(text, []), []).issues.some((issue) => issue.code === "payment_projection_label_required"));
  assert.equal(validateUiSemantics("Prepara un pago", narrative(`SIMULATED: ${text} No se ha movido dinero.`, []), []).success, true);
});
