import assert from "node:assert/strict";
import test from "node:test";
import {
  uiEventSchema,
  type TextAgentStreamEvent,
  type UIEvent,
  type UISpecification,
} from "@banorte/contracts";
import { createUiEventQuery, reconcileUiEventControl, SharedUiEventValidationError } from "../src/integration/shared-ui-event.js";
import { adaptUiDataSource } from "../src/integration/shared-contract-adapter.js";
import {
  ACTOR_ID,
  ChallengeHarness,
  interactionRequest,
  queryRequest,
  referenceFrom,
} from "./support/challenge-harness.js";

const SESSION_ID = "34000000-0000-4000-8000-000000000001";

const controls: UISpecification = {
  version: "1",
  root: {
    type: "stack",
    id: "interaction-controls",
    gap: "md",
    children: [
      {
        type: "dateRange",
        id: "period-control",
        label: "Periodo",
        event: "period.changed",
        min: "2026-01-01",
        max: "2026-12-31",
        required: true,
      },
      {
        type: "select",
        id: "account-control",
        label: "Cuenta",
        event: "account.changed",
        options: [
          { value: "checking", label: "Cuenta principal" },
          { value: "savings", label: "Ahorro" },
        ],
        required: true,
      },
      {
        type: "slider",
        id: "amount-control",
        label: "Ahorro mensual",
        event: "simulation.changed",
        min: 0,
        max: 15_000,
        step: 250,
      },
      {
        type: "button",
        id: "refresh-control",
        label: "Actualizar",
        event: "analysis.refresh.requested",
      },
    ],
  },
};

test("DateRange, Select, Slider y Button producen intención semántica sin seleccionar herramientas", () => {
  const events: UIEvent["event"][] = [
    { name: "period.changed", sourceId: "period-control", value: { start: "2026-08-01", end: "2026-08-31" } },
    { name: "account.changed", sourceId: "account-control", value: "savings" },
    { name: "simulation.changed", sourceId: "amount-control", value: 7_500 },
    { name: "analysis.refresh.requested", sourceId: "refresh-control" },
  ];

  for (const [index, event] of events.entries()) {
    const interaction = uiEventSchema.parse({
      version: "1",
      sessionId: SESSION_ID,
      correlationId: `35000000-0000-4000-8000-00000000000${index + 1}`,
      interfaceRevision: 2,
      dataRevision: 3,
      dataKeys: ["source_1"],
      event,
    });
    const query = createUiEventQuery(interaction, controls, "Analiza mis finanzas");
    assert.match(query, new RegExp(event.name.replaceAll(".", "\\."), "u"));
    assert.doesNotMatch(query, /"toolName"/u);
    assert.match(query, /Decide qué herramientas MCP son necesarias/u);
    assert.match(query, /selección absoluta/u);
  }
});

test("la UI recompuesta conserva el valor absoluto validado aunque el planner proponga otro", () => {
  const reconciled = reconcileUiEventControl(controls, {
    name: "simulation.changed",
    sourceId: "amount-control",
    value: 10_000,
  });
  const slider = reconciled.root.type === "stack"
    ? reconciled.root.children.find((node) => node.id === "amount-control")
    : undefined;
  assert.equal(slider?.type, "slider");
  if (slider?.type === "slider") assert.equal(slider.initialValue, 10_000);
});

test("un cambio numérico conserva identidad y validación de borradores locales sin mutar el snapshot", () => {
  const previous = structuredClone(controls);
  if (previous.root.type !== "stack") throw new Error("Expected stack");
  const note = { type: "input" as const, id: "school-note", label: "Notas", event: "form.value.changed", initialValue: "", validation: { maxLength: 500 } };
  previous.root.children.push(note);
  const generated = structuredClone(previous);
  if (generated.root.type !== "stack") throw new Error("Expected stack");
  generated.root.children[generated.root.children.length - 1] = { ...note, id: "new-note", validation: { maxLength: 1000 } };
  const result = reconcileUiEventControl(generated, { name: "simulation.changed", sourceId: "amount-control", value: 10_000 }, previous);
  if (result.root.type !== "stack") throw new Error("Expected stack");
  assert.deepEqual(result.root.children.at(-1), note);
  assert.equal(generated.root.children.at(-1)?.id, "new-note");
  assert.deepEqual(previous.root.children.at(-1), note);
});

test("controles que comparten evento no sobrescriben selecciones ajenas", () => {
  const specification = structuredClone(controls);
  if (specification.root.type !== "stack") throw new Error("Expected stack");
  specification.root.children.push({
    type: "slider", id: "other-amount", label: "Otro ahorro",
    event: "simulation.changed", min: 0, max: 15_000, step: 250, initialValue: 500,
  });
  const reconciled = reconcileUiEventControl(specification, {
    name: "simulation.changed", sourceId: "amount-control", value: 10_000,
  });
  if (reconciled.root.type !== "stack") throw new Error("Expected stack");
  const other = reconciled.root.children.find((node) => node.id === "other-amount");
  if (other?.type !== "slider") throw new Error("Expected slider");
  assert.equal(other.initialValue, 500);
  assert.deepEqual(reconcileUiEventControl(specification, {
    name: "simulation.changed", sourceId: "unknown", value: 10_000,
  }), specification);
});

test("los importes de simulación llegan al renderer como números formateables", () => {
  const adapted = adaptUiDataSource({
    id: "source-1",
    toolName: "simulate_savings",
    data: {
      dataType: "SIMULATED",
      projectedBalance: "120000.00",
      totalContributions: "120000.00",
      estimatedGrowth: "0.00",
      numberOfPeriods: 8,
      timeline: [{ period: 1, contribution: "15000.00", interestEarned: "0.00", balance: "15000.00" }],
    },
  }, 0);
  const value = adapted.value as Record<string, unknown>;
  assert.equal(value.projectedBalance, 120000);
  assert.equal(value.totalContributions, 120000);
  assert.deepEqual(value.timeline, [{ period: 1, contribution: 15000, interestEarned: 0, balance: 15000 }]);
});

test("BP1 normaliza porcentajes anidados de compare_periods como fracciones", () => {
  const value = adaptUiDataSource({
    id: "source-1",
    toolName: "compare_periods",
    data: {
      comparisons: [{
        currency: "MXN",
        income: { previousValue: "30000.00", currentValue: "30000.00", absoluteChange: "0.00", percentageChange: "0.00", trend: "unchanged" },
        expenses: { previousValue: "20650.00", currentValue: "27600.00", absoluteChange: "6950.00", percentageChange: "33.66", trend: "increased" },
        savingsRate: { previousValue: "31.17", currentValue: "8.00", absoluteChange: "-23.17", percentageChange: "-74.33", trend: "decreased" },
        categories: [],
      }],
      metadata: { queriedAt: "2026-09-12T00:00:00.000Z", previousPeriod: { startDate: "2026-07-01", endDate: "2026-07-31" }, currentPeriod: { startDate: "2026-08-01", endDate: "2026-08-31" } },
    },
  }).value as Record<string, unknown>;
  const comparison = (value.comparisons as Array<Record<string, unknown>>)[0]!;
  const savingsRate = comparison.savingsRate as Record<string, unknown>;
  const expenses = comparison.expenses as Record<string, unknown>;

  assert.equal(savingsRate.currentValue, 0.08);
  assert.equal(savingsRate.previousValue, 0.3117);
  assert.equal(savingsRate.absoluteChange, -0.2317);
  assert.equal(savingsRate.percentageChange, -0.7433);
  assert.equal(expenses.currentValue, 27600);
  assert.equal(expenses.percentageChange, 0.3366);
});

test("rechaza eventos fabricados o valores que no pertenecen al control", () => {
  const forged = uiEventSchema.parse({
    version: "1",
    sessionId: SESSION_ID,
    correlationId: "35000000-0000-4000-8000-000000000010",
    interfaceRevision: 2,
    dataRevision: 3,
    dataKeys: ["source_1"],
    event: { name: "account.changed", sourceId: "period-control", value: "savings" },
  });
  assert.throws(() => createUiEventQuery(forged, controls), SharedUiEventValidationError);

  const invalidSlider = uiEventSchema.parse({
    ...forged,
    correlationId: "35000000-0000-4000-8000-000000000011",
    event: { name: "simulation.changed", sourceId: "amount-control", value: 7_525 },
  });
  assert.throws(() => createUiEventQuery(invalidSlider, controls), SharedUiEventValidationError);
});

test("un Slider vuelve al Agent, recalcula por MCP y produce DataPatch/UIPatch sin prompt nuevo", async () => {
  const harness = new ChallengeHarness();
  await harness.run(queryRequest(
    SESSION_ID,
    "35000000-0000-4000-8000-000000000020",
    "Quiero ahorrar $50,000 en 8 meses.",
  ));
  const initial = harness.sessions.latest();

  const events = await harness.run(interactionRequest(
    SESSION_ID,
    "35000000-0000-4000-8000-000000000021",
    initial,
    { name: "simulation.changed", sourceId: "monthly-saving", value: 7_500 },
  ));

  assertSuccessful(events);
  assert.ok(events.some((event) => event.type === "data-patch"));
  assert.ok(events.some((event) => event.type === "ui-patch"));
  const simulations = harness.toolCalls.filter((call) => call.name === "simulate_savings");
  assert.equal(simulations.at(-1)?.arguments.periodicContribution, "7500.00");
  const completed = harness.sessions.latest();
  assert.equal(completed.prompt, undefined);
  assert.equal(completed.interaction?.name, "simulation.changed");
  assert.equal(completed.interaction?.value, 7_500);
  assert.ok(completed.interfaceRevision > initial.interfaceRevision);
  assert.ok(completed.dataRevision > initial.dataRevision);

  const inspectionCorrelationId = "35000000-0000-4000-8000-000000000022";
  const inspection = await harness.sessions.begin({
    actorId: ACTOR_ID,
    sessionId: SESSION_ID,
    correlationId: inspectionCorrelationId,
    reference: referenceFrom(completed),
  });
  assert.equal(inspection.success, true);
  if (!inspection.success) return;
  assert.equal(inspection.state.turns.length, 1, "la interacción no debe fingir un prompt escrito");
  assert.equal(inspection.state.interactionState["simulation.changed"], 7_500);
  await harness.sessions.release(ACTOR_ID, SESSION_ID, inspectionCorrelationId);
});

test("una revisión obsoleta se rechaza antes de invocar MCP", async () => {
  const harness = new ChallengeHarness();
  await harness.run(queryRequest(
    SESSION_ID,
    "35000000-0000-4000-8000-000000000030",
    "Quiero ahorrar $50,000 en 8 meses.",
  ));
  const current = harness.sessions.latest();
  const callsBefore = harness.toolCalls.length;
  const events = await harness.run(interactionRequest(
    SESSION_ID,
    "35000000-0000-4000-8000-000000000031",
    current,
    { name: "simulation.changed", sourceId: "monthly-saving", value: 7_500 },
    -1,
  ));

  assert.equal(errorCode(events), "session_revision_conflict");
  assert.equal(harness.toolCalls.length, callsBefore);
});

function assertSuccessful(events: TextAgentStreamEvent[]) {
  assert.equal(events[0]?.type, "started");
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(events.some((event) => event.type === "error"), false);
}

function errorCode(events: TextAgentStreamEvent[]) {
  const error = events.find((event) => event.type === "error");
  return error?.type === "error" ? error.error.code : undefined;
}
