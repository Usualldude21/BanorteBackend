import assert from "node:assert/strict";
import test from "node:test";
import {
  textAgentStreamEventSchema,
  uiSpecificationSchema,
  type TextAgentStreamEvent,
  type UINode,
} from "@banorte/contracts";
import {
  ACCOUNT_ID,
  ACTOR_ID,
  BENEFICIARY_ID,
  ChallengeHarness,
  PAYMENT_INTENT_ID,
  confirmationRequest,
  queryRequest,
} from "./support/challenge-harness.js";

const SIMPLE_SESSION = "11000000-0000-4000-8000-000000000001";
const ANALYSIS_SESSION = "11000000-0000-4000-8000-000000000002";
const SAVINGS_SESSION = "11000000-0000-4000-8000-000000000003";
const PAYMENT_SESSION = "11000000-0000-4000-8000-000000000004";

test("B10 caso 1: consulta saldo mediante MCP y genera una UI mínima válida", async () => {
  const harness = new ChallengeHarness();
  const events = await harness.run(queryRequest(
    SIMPLE_SESSION,
    correlation(1),
    "¿Cuánto tengo?",
  ));

  assertSuccessfulContractStream(events);
  assert.deepEqual(toolNames(harness), ["get_accounts"]);
  assertDataWasEmitted(events, "accounts");
  const types = nodeTypes(harness.sessions.latest().specification!.root);
  assert.ok(types.includes("metric"));
  assert.equal(types.includes("visualization"), false);
  assert.equal(types.includes("table"), false);
});

test("B10 caso 2: analiza el gasto y adapta la UI al resultado", async () => {
  const harness = new ChallengeHarness();
  const events = await harness.run(queryRequest(
    ANALYSIS_SESSION,
    correlation(2),
    "¿En qué se me está yendo el dinero?",
  ));

  assertSuccessfulContractStream(events);
  assert.deepEqual(toolNames(harness), ["get_spending_by_category"]);
  assertDataWasEmitted(events, "categories");
  assert.ok(nodeTypes(harness.sessions.latest().specification!.root).includes("visualization"));
});

test("B10 caso 3: combina datos observados con una simulación determinista e interactiva", async () => {
  const harness = new ChallengeHarness();
  const events = await harness.run(queryRequest(
    SAVINGS_SESSION,
    correlation(3),
    "Quiero ahorrar $50,000 en 8 meses.",
  ));

  assertSuccessfulContractStream(events);
  assert.deepEqual(new Set(toolNames(harness)), new Set(["get_accounts", "simulate_savings"]));
  const simulation = emittedValues(events).find((value) => value.dataType === "SIMULATED");
  assert.equal(simulation?.projectedBalance, 50000);
  assert.ok(nodeTypes(harness.sessions.latest().specification!.root).includes("slider"));
});

test("B10 caso 4: el follow-up conserva sesión, recalcula y emite UIPatch", async () => {
  const harness = new ChallengeHarness();
  await harness.run(queryRequest(
    SAVINGS_SESSION,
    correlation(4),
    "Quiero ahorrar $50,000 en 8 meses.",
  ));
  const firstState = harness.sessions.latest();

  const followUp = await harness.run(queryRequest(
    SAVINGS_SESSION,
    correlation(5),
    "¿Y si puedo ahorrar $1,000 más?",
    firstState,
  ));

  assertSuccessfulContractStream(followUp);
  const savingsCalls = harness.toolCalls.filter((call) => call.name === "simulate_savings");
  assert.equal(savingsCalls.length, 2);
  assert.equal(savingsCalls[0]?.arguments.periodicContribution, "6250.00");
  assert.equal(savingsCalls[1]?.arguments.periodicContribution, "7250.00");
  assert.ok(followUp.some((event) => event.type === "ui-patch"));
  assert.ok(harness.sessions.latest().interfaceRevision > firstState.interfaceRevision);
  assert.match(harness.modelQueries.at(-1) ?? "", /constraintsChanged/u);
});

test("B10 caso 5: UIEvent autorizado confirma un intent existente y persiste sus efectos", async () => {
  const harness = new ChallengeHarness();
  harness.bank.execute({ name: "create_payment_intent", arguments: {
    sourceAccountId: ACCOUNT_ID, beneficiaryId: BENEFICIARY_ID,
    amount: "500.00", currency: "MXN", concept: "Reto Banorte",
  } });
  await harness.sessions.begin({ actorId: ACTOR_ID, sessionId: PAYMENT_SESSION, correlationId: correlation(6) });
  await harness.sessions.complete({
    actorId: ACTOR_ID, sessionId: PAYMENT_SESSION, correlationId: correlation(6),
    interfaceRevision: 0, dataRevision: 0, dataKeys: [], answer: "Pago pendiente",
    pendingPaymentIntentId: PAYMENT_INTENT_ID,
    specification: uiSpecificationSchema.parse({ version: "1", root: {
      type: "button", id: "confirm-payment", label: "Confirmar pago", event: "payment.confirmed",
    } }),
  });
  const preparedState = harness.sessions.latest();
  const preparedUi = uiSpecificationSchema.parse(preparedState.specification);
  assert.ok(findNode(preparedUi.root, (node) => node.type === "button" && node.event === "payment.confirmed"));
  assert.equal(harness.bank.balanceCents, 3_874_265);

  const manipulated = await harness.run(confirmationRequest(
    PAYMENT_SESSION,
    correlation(7),
    preparedState,
    1,
  ));
  assert.equal(errorCode(manipulated), "session_revision_conflict");
  assert.equal(harness.bank.balanceCents, 3_874_265);
  assert.equal(toolNames(harness).includes("confirm_payment"), false);

  const confirmation = await harness.run(confirmationRequest(
    PAYMENT_SESSION,
    correlation(8),
    preparedState,
  ));
  assertSuccessfulContractStream(confirmation);
  assert.deepEqual(toolNames(harness), ["confirm_payment"]);
  assert.equal(harness.bank.balanceCents, 3_824_265);
  assert.equal(harness.bank.payments.length, 1);
  assert.equal(harness.bank.transactions.length, 1);
  const receipt = emittedValues(confirmation).find((value) => value.status === "succeeded");
  assert.equal(receipt?.balanceAfter, 38_242.65);
  assert.ok(confirmation.some((event) => event.type === "ui-patch"));
  assert.equal(harness.sessions.latest().pendingPaymentIntentId, null);
});

function assertSuccessfulContractStream(events: TextAgentStreamEvent[]): void {
  assert.ok(events.length > 0);
  events.forEach((event, index) => {
    assert.doesNotThrow(() => textAgentStreamEventSchema.parse(event));
    assert.equal(event.sequence, index + 1);
  });
  assert.equal(events[0]?.type, "started");
  assert.equal(events.at(-1)?.type, "completed");
  assert.ok(events.some((event) => event.type === "ui-completed"));
  assert.equal(events.some((event) => event.type === "error"), false);
}

function assertDataWasEmitted(events: TextAgentStreamEvent[], expectedKey: string): void {
  assert.ok(emittedValues(events).some((value) => expectedKey in value));
}

function emittedValues(events: TextAgentStreamEvent[]): Array<Record<string, unknown>> {
  return events.flatMap((event) => (
    event.type === "data-patch" && event.patch.op !== "invalidate" && isRecord(event.patch.value)
      ? [event.patch.value]
      : []
  ));
}

function toolNames(harness: ChallengeHarness): string[] {
  return harness.toolCalls.map((call) => call.name);
}

function nodeTypes(root: UINode): string[] {
  const types: string[] = [];
  visit(root, (node) => types.push(node.type));
  return types;
}

function findNode(root: UINode, predicate: (node: UINode) => boolean): UINode | undefined {
  let found: UINode | undefined;
  visit(root, (node) => { if (!found && predicate(node)) found = node; });
  return found;
}

function visit(node: UINode, visitor: (node: UINode) => void): void {
  visitor(node);
  if ("children" in node) node.children.forEach((child) => visit(child, visitor));
  if (node.type === "tabs" || node.type === "accordion") {
    node.items.forEach((item) => item.children.forEach((child) => visit(child, visitor)));
  }
  if (node.type === "repeat") visit(node.template, visitor);
  if (node.type === "conditional") {
    visit(node.then, visitor);
    if (node.else) visit(node.else, visitor);
  }
}

function errorCode(events: TextAgentStreamEvent[]): string | undefined {
  return events.find((event) => event.type === "error")?.error.code;
}

function correlation(index: number): string {
  return `22000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
