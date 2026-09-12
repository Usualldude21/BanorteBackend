import assert from "node:assert/strict";
import test from "node:test";
import { uiEventSchema, type UISpecification } from "@banorte/contracts";
import { createUiEventQuery, SharedUiEventValidationError } from "../src/integration/shared-ui-event.js";
import { paymentReviewPermission } from "../src/integration/payment-review-permission.js";
import { createPaymentWriteAuthorizer } from "../src/application/ports/payment-write-authorization.js";

const spec: UISpecification = { version: "1", root: { type: "stack", id: "capture", children: [
  { type: "select", id: "origin", label: "Cuenta de origen", event: "form.value.changed", required: true, options: [{ value: "checking", label: "Principal" }] },
  { type: "select", id: "destination", label: "Beneficiario", event: "form.value.changed", required: true, options: [{ value: "family", label: "Ahorro Familiar" }] },
  { type: "input", id: "concept", label: "Concepto", event: "form.value.changed", validation: { maxLength: 140 } },
  { type: "button", id: "review", label: "Revisar pago", event: "form.submit" },
] } };
const base = { version: "1", sessionId: "11000000-0000-4000-8000-000000000001", correlationId: "11000000-0000-4000-8000-000000000002", interfaceRevision: 2, dataRevision: 3, dataKeys: [] };
const validFields = { origin: "checking", destination: "family", concept: "Prueba L11" };

test("L11 formulario completo conserva campos tipados y eventos anteriores", () => {
  const event = uiEventSchema.parse({ ...base, event: { name: "form.submit", sourceId: "review", formValues: validFields } });
  const query = createUiEventQuery(event, spec, "Prepara un pago de $500");
  assert.match(query, /formFields/u);
  assert.match(query, /Prueba L11/u);
  assert.equal(uiEventSchema.safeParse({ ...base, event: { name: "analysis.refresh.requested", sourceId: "refresh" } }).success, true);
  assert.equal(uiEventSchema.safeParse({ ...base, event: { name: "payment.confirmed", sourceId: "review", formValues: validFields } }).success, false);
});

test("L11 permiso de revisión ligado a parámetros exactos y de un solo uso", () => {
  const account = "20000000-0000-4000-8000-000000000001";
  const beneficiary = "30000000-0000-4000-8000-000000000001";
  const financial = structuredClone(spec);
  if (financial.root.type !== "stack") throw new Error("Expected stack");
  for (const node of financial.root.children) if (node.type === "select") node.options = [{ value: node.id === "origin" ? account : beneficiary, label: "Verificado" }];
  const event = uiEventSchema.parse({ ...base, event: { name: "form.submit", sourceId: "review", formValues: { origin: account, destination: beneficiary, concept: "Prueba L11" } } });
  const permission = paymentReviewPermission(event, financial, "Prepara un pago de $500 MXN");
  assert.ok(permission?.payment);
  const authorizer = createPaymentWriteAuthorizer({ actorId: "demo", sessionId: base.sessionId, correlationId: base.correlationId, interfaceRevision: 2, dataRevision: 3, permissions: [permission] });
  const attempt = { actorId: "demo", toolName: "create_payment_intent" as const, payment: permission.payment };
  for (const change of [{ amount: "501" }, { beneficiaryId: account }, { sourceAccountId: beneficiary }, { currency: "USD" }, { concept: "Cambiado" }]) assert.equal(authorizer.consume({ ...attempt, payment: { ...permission.payment, ...change } }), false);
  assert.equal(authorizer.consume({ ...attempt, payment: { ...permission.payment, amount: "500.00" } }), true);
  assert.equal(authorizer.consume(attempt), false);
  assert.throws(() => paymentReviewPermission(event, financial, "Prepara $500 MXN", "pending"), SharedUiEventValidationError);
  assert.throws(() => paymentReviewPermission(event, financial, "Prepara $500 o $600 MXN"), SharedUiEventValidationError);
});

test("L11 rechaza omisiones, campos ajenos, selección inventada y exceso de longitud", () => {
  for (const fields of [undefined, { ...validFields, origin: "" }, { ...validFields, destination: "invented" }, { origin: "checking", concept: "Prueba" }, { ...validFields, foreign: "x" }, { ...validFields, concept: "x".repeat(141) }]) {
    const event = uiEventSchema.parse({ ...base, event: { name: "form.submit", sourceId: "review", ...(fields ? { formValues: fields } : {}) } });
    assert.throws(() => createUiEventQuery(event, spec), SharedUiEventValidationError);
  }
});
