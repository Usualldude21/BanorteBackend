import assert from "node:assert/strict";
import test from "node:test";
import { emptyFinancialConstraints, updateFinancialConstraints } from "../src/domain/financial-constraints.js";
import { createFollowUpQuery, type AgentSessionSnapshot } from "../src/integration/agent-session-store.js";
import {
  groundComparisonPeriodDisclosure,
  validateFinancialReasoning,
} from "../src/agent/reasoning/financial-reasoning-validator.js";
import { createIntentAwareUiFallback } from "../src/ui/generation/intent-aware-ui-fallback.js";
import { validateUiSemantics } from "../src/ui/generation/semantic-ui-validator.js";
import { parseUiDocument } from "../src/ui/dsl/ui.schema.js";
import { SimulationService } from "../src/services/simulation.service.js";

test("conserva y versiona las restricciones financieras relevantes", () => {
  const first = updateFinancialConstraints(
    emptyFinancialConstraints(),
    "Quiero ahorrar 50k en 8 meses, puedo ahorrar 4k al mes y no puedo reducir la renta.",
  );

  assert.equal(first.changed, true);
  assert.deepEqual(first.constraints, {
    revision: 1,
    savingsGoal: { amount: "50000.00", currency: "MXN" },
    horizonMonths: 8,
    monthlyContribution: { amount: "4000.00", currency: "MXN" },
    protectedExpenseCategories: ["housing"],
  });

  const unchanged = updateFinancialConstraints(first.constraints, "Muéstrame el resultado otra vez");
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.constraints.revision, 1);

  const changed = updateFinancialConstraints(first.constraints, "Ahora sí puedo reducir la renta");
  assert.equal(changed.changed, true);
  assert.equal(changed.constraints.revision, 2);
  assert.deepEqual(changed.constraints.protectedExpenseCategories, []);
});

test("invalida recomendaciones anteriores cuando cambia una restricción", () => {
  const state: AgentSessionSnapshot = {
    sessionId: "session-1", interfaceRevision: 1, dataRevision: 1, dataKeys: [],
    turns: [{ user: "Hazme un plan", assistant: "RECOMMENDED: ahorra 3,000 al mes" }],
    interactionState: {}, financialConstraints: emptyFinancialConstraints(),
  };

  const query = createFollowUpQuery(state, "Puedo ahorrar 4k/mes");

  assert.match(query, /"constraintsChanged":true/u);
  assert.match(query, /RECOMMENDED anterior invalidada/u);
  assert.doesNotMatch(query, /ahorra 3,000 al mes/u);
});

test("marca las proyecciones del motor determinístico como simuladas", () => {
  const result = new SimulationService().simulateSavings({
    initialAmount: "1000.00", periodicContribution: "500.00", annualRate: "0.00",
    durationMonths: 2, frequency: "monthly",
  });

  assert.equal(result.dataType, "SIMULATED");
  assert.equal(result.projectedBalance, "2000.00");
});

test("rechaza etiquetas de evidencia sin una conclusión legible", () => {
  const issues = validateFinancialReasoning({
    query: "Muéstrame mis cuentas y saldos",
    answer: "OBSERVED:",
    toolsUsed: ["get_accounts"],
    dataSources: [],
  });

  assert.ok(issues.some((issue) => issue.code === "substantive-answer-required"));
});

test("conserva comparaciones válidas y agrega la advertencia de meses con distinta duración", () => {
  const dataSources = [{
    id: "comparison-source",
    toolName: "compare_periods",
    data: {
      comparisons: [],
      metadata: {
        queriedAt: "2026-09-13T00:00:00.000Z",
        previousPeriod: { startDate: "2026-06-01", endDate: "2026-06-30" },
        currentPeriod: { startDate: "2026-07-01", endDate: "2026-07-31" },
        currency: "MXN",
      },
    },
  }];

  const answer = groundComparisonPeriodDisclosure(
    dataSources,
    "El gasto aumentó principalmente en entretenimiento y restaurantes.",
  );

  assert.match(answer, /Nota de comparabilidad/u);
  assert.match(answer, /distinta duración/u);
  assert.ok(!validateFinancialReasoning({
    query: "Compara mis gastos de junio y julio",
    answer,
    toolsUsed: ["compare_periods"],
    dataSources,
  }).some((issue) => issue.code === "partial-period-disclosure-required"));
});

test("BP3 exige evidencia aun cuando el modelo agregue una conclusión negativa de anomalías", () => {
  const issues = validateFinancialReasoning({
    query: "Compara mis gastos de julio y agosto de 2026",
    answer: "Tus gastos aumentaron 33.7%, sin anomalías estadísticas registradas.",
    toolsUsed: ["compare_periods"],
    dataSources: [],
  });

  assert.ok(issues.some((issue) => issue.code === "anomaly-evidence-required"));
});

test("BP2 no confunde cero grupos elegibles con ausencia de anomalías", () => {
  const dataSources = [{ id: "anomalies-source", toolName: "detect_transaction_anomalies", data: {
    anomalies: [], metadata: {
      queriedAt: "2026-09-12T00:00:00.000Z", startDate: "2026-08-01", endDate: "2026-08-31",
      filters: {}, evaluatedTransactions: 25, eligibleGroups: 0, method: "iqr", minSampleSize: 8,
    },
  } }];
  const unsafe = validateFinancialReasoning({
    query: "Busca movimientos atípicos en agosto de 2026",
    answer: "No se identificaron importes atípicos en agosto.",
    toolsUsed: ["detect_transaction_anomalies"], dataSources,
  });
  assert.ok(unsafe.some((issue) => issue.code === "anomaly-sample-insufficient"));
  const qualifiedUnsafe = validateFinancialReasoning({
    query: "¿Hay algo fuera de lo habitual en mis movimientos de agosto?",
    answer: "No se identificaron importes estadísticamente atípicos en agosto.",
    toolsUsed: ["detect_transaction_anomalies"], dataSources,
  });
  assert.ok(qualifiedUnsafe.some((issue) => issue.code === "anomaly-sample-insufficient"));
  const screenshotUnsafe = validateFinancialReasoning({
    query: "¿Hay algo fuera de lo habitual en mis movimientos de agosto?",
    answer: "No se identificaron importes inusuales. La solidez de la señal no es concluyente.",
    toolsUsed: ["detect_transaction_anomalies"], dataSources,
  });
  assert.ok(screenshotUnsafe.some((issue) => issue.code === "anomaly-sample-insufficient"));

  const safe = validateFinancialReasoning({
    query: "Busca movimientos atípicos en agosto de 2026",
    answer: "La muestra es insuficiente: 25 transacciones evaluadas, cero grupos elegibles y mínimo de ocho por grupo.",
    toolsUsed: ["detect_transaction_anomalies"], dataSources,
  });
  assert.ok(!safe.some((issue) => issue.code === "anomaly-sample-insufficient"));
  const ui = createIntentAwareUiFallback("Busca movimientos atípicos en agosto de 2026", dataSources, "personal_banking");
  assert.equal(ui?.root.type, "alert");
  if (ui?.root.type === "alert") assert.match(ui.root.text, /Muestra insuficiente.*25 transacciones.*cero grupos.*mínimo de 8/u);
  assert.ok(ui);
  assert.deepEqual(validateUiSemantics("Busca movimientos atípicos en agosto de 2026", ui, dataSources,
    { enforcePersonalBankingComposition: true }), { success: true, issues: [] });
  const misleading = parseUiDocument({ version: "1.0", root: {
    id: "anomaly-misleading", type: "alert", severity: "info", text: "No se detectaron anomalías estadísticas.",
  } }, dataSources);
  const misleadingResult = validateUiSemantics("Busca movimientos atípicos en agosto de 2026", misleading,
    dataSources, { enforcePersonalBankingComposition: true });
  assert.equal(misleadingResult.success, false);
  if (!misleadingResult.success) assert.ok(misleadingResult.issues.some((issue) => issue.code === "personal_anomaly_sample_disclosure_required"));
});

test("GEN3 exige reconocer que los conceptos no son comercios verificados", () => {
  const dataSources = [{ id: "transactions-source", toolName: "get_transactions", data: { transactions: [] } }];
  const query = "¿En cuáles comercios hice más compras durante agosto de 2026?";
  const unsafe = validateFinancialReasoning({ query, answer: "El comercio principal fue Restaurante.",
    toolsUsed: ["get_transactions"], dataSources });
  assert.ok(unsafe.some((issue) => issue.code === "merchant-identity-unavailable"));
  const safe = validateFinancialReasoning({ query,
    answer: "Los movimientos sólo muestran conceptos; no hay nombres de comercios verificados para atribuir las compras.",
    toolsUsed: ["get_transactions"], dataSources });
  assert.ok(!safe.some((issue) => issue.code === "merchant-identity-unavailable"));
});

test("BP2 exige transferencias históricas filtradas y visibles, sin habilitar pagos", () => {
  const query = "Entre junio y agosto de 2026, ¿mis transferencias hacia ahorro son gasto real o movimientos entre mis cuentas?";
  const transferSource = { id: "transfer-source", toolName: "get_transactions", data: {
    transactions: [{ id: "50000000-0000-4000-8000-000000000001", accountId: "40000000-0000-4000-8000-000000000001",
      type: "transfer", amount: "2000.00", currency: "MXN", description: "Transferencia a ahorro",
      category: "transfers", transactionDate: "2026-08-20" }],
    pagination: { limit: 25, offset: 0, returned: 1, hasMore: false },
    metadata: { queriedAt: "2026-09-12T00:00:00.000Z", appliedFilters: {
      startDate: "2026-06-01", endDate: "2026-08-31", transactionType: "transfer",
    } },
  } };
  const answer = "Las transferencias entre tus cuentas son movimientos internos, no gasto externo.";
  const missing = validateFinancialReasoning({ query, answer, toolsUsed: [], dataSources: [] });
  assert.ok(missing.some((issue) => issue.code === "transfer-history-evidence-required"));
  const supported = validateFinancialReasoning({ query, answer, toolsUsed: ["get_transactions"], dataSources: [transferSource] });
  assert.ok(!supported.some((issue) => issue.code === "transfer-history-evidence-required"));
  const fallback = createIntentAwareUiFallback(query, [transferSource], "personal_banking");
  assert.ok(fallback);
  assert.deepEqual(validateUiSemantics(query, fallback, [transferSource], { enforcePersonalBankingComposition: true }),
    { success: true, issues: [] });
  const accountSource = { id: "account-source", toolName: "get_accounts", data: {
    accounts: [{ id: "40000000-0000-4000-8000-000000000001", name: "Cuenta principal" }],
  } };
  const unrelated = parseUiDocument({ version: "1.0", root: {
    id: "account-table", type: "table", title: "Cuentas", data: { sourceId: accountSource.id, path: "accounts" },
    columns: [{ key: "name", label: "Cuenta" }], maxRows: 1,
  } }, [transferSource, accountSource]);
  const unrelatedResult = validateUiSemantics(query, unrelated, [transferSource, accountSource], { enforcePersonalBankingComposition: true });
  assert.equal(unrelatedResult.success, false);
  if (!unrelatedResult.success) assert.ok(unrelatedResult.issues.some((issue) => issue.code === "personal_transfer_history_table_required"));

  const noTransfers = { ...transferSource, data: {
    ...transferSource.data, transactions: [], pagination: { limit: 25, offset: 0, returned: 0, hasMore: false },
  } };
  const emptyUi = createIntentAwareUiFallback(query, [noTransfers, accountSource], "personal_banking");
  assert.equal(emptyUi?.root.type, "alert");
  if (emptyUi?.root.type === "alert") assert.match(emptyUi.root.text, /No hay transferencias registradas/u);
  assert.ok(emptyUi);
  assert.deepEqual(validateUiSemantics(query, emptyUi, [noTransfers, accountSource],
    { enforcePersonalBankingComposition: true }), { success: true, issues: [] });
  const misleadingEmpty = validateUiSemantics(query, unrelated, [noTransfers, accountSource],
    { enforcePersonalBankingComposition: true });
  assert.equal(misleadingEmpty.success, false);
  if (!misleadingEmpty.success) assert.ok(misleadingEmpty.issues.some((issue) => issue.code === "personal_transfer_history_empty_state_required"));
});
