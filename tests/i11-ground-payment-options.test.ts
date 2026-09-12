import assert from "node:assert/strict";
import test from "node:test";
import { parseUiDocument, type UiDataSource } from "../src/ui/dsl/ui.schema.js";
import { groundPaymentFormOptions } from "../src/ui/generation/ground-payment-form-options.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";

const sources: UiDataSource[] = [
  { id: "source-1", toolName: "get_accounts", data: { accounts: [{ id: "20000000-0000-4000-8000-000000000001", name: "Cuenta principal", status: "active", type: "checking" }, { id: "20000000-0000-4000-8000-000000000003", name: "Tarjeta de crédito", status: "active", type: "credit_card" }] } },
  { id: "source-2", toolName: "get_beneficiaries", data: { beneficiaries: [{ id: "30000000-0000-4000-8000-000000000001", name: "Servicios del Hogar", status: "active" }] } },
];

test("L11 ancla opciones dinámicas a UUID verificados y conserva precarga única", () => {
  const ui = parseUiDocument({ version: "1.0", root: { type: "form", id: "payment-form", title: "Pago", submitLabel: "Revisar pago", fields: [
    { type: "select", id: "origin", label: "Cuenta de origen", options: [{ label: "Cuenta principal (******4821)", value: "checking" }], initialValue: "checking" },
    { type: "select", id: "destination", label: "Beneficiario", options: [{ label: "Servicios del Hogar", value: "home" }], initialValue: "home" },
  ] } }, sources);
  const grounded = groundPaymentFormOptions(ui, sources);
  if (grounded.root.type !== "form") throw new Error("Expected form");
  const [origin, destination] = grounded.root.fields;
  if (origin?.type !== "select" || destination?.type !== "select") throw new Error("Expected selects");
  assert.equal(origin.options[0]?.value, "20000000-0000-4000-8000-000000000001");
  assert.equal(destination.initialValue, "30000000-0000-4000-8000-000000000001");
  assert.equal(validateUiSemantics("Prepara un pago desde Cuenta principal a Servicios del Hogar", grounded, sources).success, true);
});

test("L11 no convierte una tarjeta ni un nombre no verificado en opción válida", () => {
  const ui = parseUiDocument({ version: "1.0", root: { type: "form", id: "payment-form", title: "Pago", submitLabel: "Revisar pago", fields: [
    { type: "select", id: "origin", label: "Cuenta de origen", options: [{ label: "Tarjeta de crédito", value: "card" }] },
    { type: "select", id: "destination", label: "Beneficiario", options: [{ label: "Arturo", value: "unknown" }] },
  ] } }, sources);
  const grounded = groundPaymentFormOptions(ui, sources);
  const result = validateUiSemantics("Prepara un pago a Arturo", grounded, sources);
  assert.ok(result.issues.some((issue) => issue.code === "payment_option_unverified"));
});
