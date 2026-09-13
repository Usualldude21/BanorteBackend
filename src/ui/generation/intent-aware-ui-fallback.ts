import { type UiDataSource, type UiDocument } from "../dsl/ui.schema.js";
import {
  LIQUIDITY_ANALYSIS_SOURCE,
  requiresLiquidityPrecursorAnalysis,
} from "../../agent/reasoning/financial-intent-data-shaper.js";
import type { FinancialExperienceScope } from "../../agent/security/financial-scope-policy.js";
import { COMPARISON_CATEGORY_VIEW_SOURCE } from "../../agent/reasoning/financial-intent-data-shaper.js";

export function createIntentAwareUiFallback(
  query: string,
  dataSources: readonly UiDataSource[],
  experienceScope: FinancialExperienceScope = "full",
): UiDocument | undefined {
  if (requiresLiquidityPrecursorAnalysis(query)) {
    const source = dataSources.find((candidate) => candidate.toolName === LIQUIDITY_ANALYSIS_SOURCE);
    if (source) return createLiquidityFallback(source);
  }

  const receiptSource = dataSources.find((candidate) => candidate.toolName === "confirm_payment");
  if (receiptSource) return createPaymentReceiptFallback(receiptSource);
  const intentSource = dataSources.find((candidate) => candidate.toolName === "create_payment_intent");
  if (intentSource) return createPaymentIntentFallback(intentSource, dataSources);

  const healthSource = dataSources.find((candidate) => candidate.toolName === "evaluate_financial_health");
  if (healthSource && requestsFinancialHealthExplanation(query)) {
    return createFinancialHealthFallback(healthSource);
  }

  return experienceScope === "personal_banking"
    ? createPersonalBankingFallback(query, dataSources)
    : undefined;
}

/**
 * The model is normally responsible for composing the experience.  These
 * read-only compositions are deliberately small, source-bound fallbacks for
 * personal banking so an invalid planner response never leaves the customer
 * with a generic technical error or an unrelated UI.
 */
function createPersonalBankingFallback(
  query: string,
  dataSources: readonly UiDataSource[],
): UiDocument | undefined {
  const anomalies = dataSources.find((source) => source.toolName === "detect_transaction_anomalies");
  if (anomalies) return createAnomaliesFallback(anomalies);

  const transactionSources = [...dataSources].reverse().filter((source) => source.toolName === "get_transactions");
  const filteredTransfers = /\btransferencias?\b/iu.test(query)
    ? transactionSources.find((source) => isRecord(source.data) && isRecord(source.data.metadata)
      && isRecord(source.data.metadata.appliedFilters)
      && source.data.metadata.appliedFilters.transactionType === "transfer")
    : undefined;
  const transactions = filteredTransfers ?? transactionSources[0];
  if (filteredTransfers && readRows(filteredTransfers.data, "transactions").length === 0) {
    return emptyFallback("transfers-empty", "No hay transferencias registradas en el periodo y filtros consultados. No puedo confirmar movimientos propios hacia ahorro con estos datos; las transferencias internas, cuando existen, no son gasto externo.");
  }
  const comparison = [...dataSources].reverse().find((source) => source.toolName === "compare_periods");
  if (transactions && requestsTransactionDetail(query)) return createTransactionsFallback(transactions, comparison);
  if (transactions && comparison) return createTransactionsFallback(transactions, comparison);
  if (comparison) return createComparisonFallback(
    comparison,
    [...dataSources].reverse().find((source) => source.toolName === COMPARISON_CATEGORY_VIEW_SOURCE),
  );

  const categories = dataSources.find((source) => source.toolName === "get_spending_by_category");
  if (categories) return createCategoryFallback(categories);

  if (transactions) return createTransactionsFallback(transactions);

  const accounts = dataSources.find((source) => source.toolName === "get_accounts");
  return accounts ? createAccountsFallback(accounts) : undefined;
}

function requestsTransactionDetail(query: string): boolean {
  const normalized = normalizeQuery(query);
  return /\b(?:movimientos?|transacciones?|compras?|detalle|explican)\b/u.test(normalized);
}

function createAccountsFallback(source: UiDataSource): UiDocument {
  const accounts = readRows(source.data, "accounts");
  if (accounts.length === 0) {
    return emptyFallback("accounts-empty", "No hay cuentas observadas disponibles para mostrar.");
  }
  return {
    version: "1.0",
    root: {
      id: "accounts-summary",
      type: "stack",
      direction: "vertical",
      children: [
        { id: "accounts-title", type: "text", variant: "title", text: "Tus cuentas" },
        metric("accounts-count", "Cuentas disponibles", source.id, "metadata.totalAccounts", "number"),
        {
          id: "accounts-table",
          type: "table",
          title: "Saldos observados",
          data: { sourceId: source.id, path: "accounts" },
          columns: [
            { key: "name", label: "Cuenta" },
            { key: "maskedIdentifier", label: "Terminación" },
            { key: "type", label: "Tipo" },
            { key: "balance", label: "Saldo" },
            { key: "currency", label: "Moneda" },
          ],
          maxRows: 10,
        },
      ],
    },
  };
}

function createComparisonFallback(source: UiDataSource, categoryView?: UiDataSource): UiDocument {
  const comparisons = readRows(source.data, "comparisons");
  if (comparisons.length === 0) {
    return emptyFallback("comparison-empty", "No hay datos suficientes para comparar los periodos solicitados.");
  }
  const first = comparisons[0]!;
  const metrics: UiDocument["root"][] = [
    metric("expenses-before", "Gasto anterior", source.id, "comparisons.0.expenses.previousValue", "currency", "comparisons.0.currency"),
    metric("expenses-current", "Gasto actual", source.id, "comparisons.0.expenses.currentValue", "currency", "comparisons.0.currency"),
    metric("expenses-change", "Variación", source.id, "comparisons.0.expenses.absoluteChange", "currency", "comparisons.0.currency"),
  ];
  const expenses = isRecord(first.expenses) ? first.expenses : undefined;
  if (hasScalar(expenses?.percentageChange)) {
    metrics.push(metric("expenses-change-percent", "Variación porcentual", source.id, "comparisons.0.expenses.percentageChange", "percentage"));
  }
  const categoryRows = categoryView ? readRows(categoryView.data, "categories") : readRows(first, "categories");
  const categorySource = categoryView ?? source;
  const categoryPath = categoryView ? "categories" : "comparisons.0.categories";
  const categorySection: UiDocument["root"][] = categoryRows.length > 0 ? [{
    id: "comparison-categories",
    type: "table",
    title: "Categorías de la comparación, ordenadas por impacto",
    data: { sourceId: categorySource.id, path: categoryPath },
    columns: categoryView ? [
      { key: "category", label: "Categoría" },
      { key: "previousValue", label: "Anterior" },
      { key: "currentValue", label: "Actual" },
      { key: "absoluteChange", label: "Variación" },
    ] : [
      { key: "category", label: "Categoría" },
      { key: "change.previousValue", label: "Anterior" },
      { key: "change.currentValue", label: "Actual" },
      { key: "change.absoluteChange", label: "Variación" },
    ],
    maxRows: Math.min(categoryRows.length, 100),
  }] : [{
    id: "comparison-categories-empty",
    type: "alert",
    severity: "info",
    text: "No hubo categorías de gasto comparables en los periodos consultados.",
  }];
  return {
    version: "1.0",
    root: {
      id: "period-comparison",
      type: "stack",
      direction: "vertical",
      children: [
        { id: "comparison-title", type: "text", variant: "title", text: "Comparación del periodo" },
        {
          id: "comparison-metrics",
          type: "grid",
          columnCount: 2,
          children: metrics,
        },
        ...(categoryView && categoryRows.length > 1 ? [{
          id: "comparison-category-chart",
          type: "chart" as const,
          title: "Gasto por categoría: periodo anterior y actual",
          chartType: "bar" as const,
          data: { sourceId: categoryView.id, path: "categories" },
          categoryKey: "category",
          series: [
            { key: "previousValue", label: "Anterior" },
            { key: "currentValue", label: "Actual" },
          ],
        }] : []),
        ...categorySection,
      ],
    },
  };
}

function createCategoryFallback(source: UiDataSource): UiDocument {
  const categories = readRows(source.data, "categories");
  if (categories.length === 0) {
    return emptyFallback("categories-empty", "No hay gastos por categoría en el periodo consultado.");
  }
  return {
    version: "1.0",
    root: {
      id: "spending-by-category",
      type: "stack",
      direction: "vertical",
      children: [
        { id: "categories-title", type: "text", variant: "title", text: "Gasto por categoría" },
        {
          id: "categories-chart",
          type: "chart",
          title: "Distribución de gasto observado",
          chartType: "pie",
          data: { sourceId: source.id, path: "categories" },
          categoryKey: "category",
          series: [{ key: "amount", label: "Gasto" }],
        },
        {
          id: "categories-table",
          type: "table",
          title: "Detalle para explorar",
          data: { sourceId: source.id, path: "categories" },
          columns: [
            { key: "category", label: "Categoría" },
            { key: "amount", label: "Gasto" },
            { key: "percentage", label: "Participación" },
            { key: "transactionCount", label: "Movimientos" },
          ],
          maxRows: 12,
        },
      ],
    },
  };
}

function createTransactionsFallback(source: UiDataSource, comparison?: UiDataSource): UiDocument {
  const transactions = readRows(source.data, "transactions");
  if (transactions.length === 0) {
    return emptyFallback("transactions-empty", "No hay movimientos en los filtros y periodo consultados.");
  }
  return {
    version: "1.0",
    root: {
      id: "transactions-explorer",
      type: "stack",
      direction: "vertical",
      children: [
        { id: "transactions-title", type: "text", variant: "title", text: "Movimientos observados" },
        ...comparisonSummary(comparison),
        {
          id: "transactions-table",
          type: "table",
          title: "Detalle de movimientos",
          data: { sourceId: source.id, path: "transactions" },
          columns: [
            { key: "transactionDate", label: "Fecha" },
            { key: "description", label: "Descripción" },
            { key: "category", label: "Categoría" },
            { key: "type", label: "Tipo" },
            { key: "amount", label: "Monto" },
            { key: "currency", label: "Moneda" },
          ],
          maxRows: 25,
        },
      ],
    },
  };
}

function comparisonSummary(source: UiDataSource | undefined): UiDocument["root"][] {
  const comparison = source && readRows(source.data, "comparisons")[0];
  if (!source || !comparison) return [];
  return [{
    id: "transactions-comparison-summary",
    type: "grid",
    columnCount: 2,
    children: [
      metric("transactions-expenses-before", "Gasto anterior", source.id, "comparisons.0.expenses.previousValue", "currency", "comparisons.0.currency"),
      metric("transactions-expenses-current", "Gasto actual", source.id, "comparisons.0.expenses.currentValue", "currency", "comparisons.0.currency"),
      metric("transactions-expenses-change", "Variación", source.id, "comparisons.0.expenses.absoluteChange", "currency", "comparisons.0.currency"),
    ],
  }];
}

function createAnomaliesFallback(source: UiDataSource): UiDocument {
  const anomalies = readRows(source.data, "anomalies");
  if (anomalies.length === 0) {
    const metadata = isRecord(source.data) && isRecord(source.data.metadata) ? source.data.metadata : undefined;
    const insufficient = metadata?.eligibleGroups === 0;
    const detail = insufficient
      ? `Muestra insuficiente para evaluar anomalías estadísticas: ${String(metadata?.evaluatedTransactions ?? "desconocidas")} transacciones evaluadas, cero grupos elegibles y mínimo de ${String(metadata?.minSampleSize ?? "desconocido")} por grupo. No es evidencia de normalidad.`
      : "No se detectaron anomalías estadísticas en los grupos evaluables del periodo consultado; esto no descarta movimientos no evaluables ni constituye una conclusión de fraude.";
    return emptyFallback("anomalies-empty", detail);
  }
  return {
    version: "1.0",
    root: {
      id: "anomalies-review",
      type: "stack",
      direction: "vertical",
      children: [
        {
          id: "anomalies-notice",
          type: "alert",
          severity: "info",
          text: "Estas señales son anomalías estadísticas; no constituyen una conclusión de fraude.",
        },
        {
          id: "anomalies-table",
          type: "table",
          title: "Movimientos fuera del rango esperado",
          data: { sourceId: source.id, path: "anomalies" },
          columns: [
            { key: "transactionDate", label: "Fecha" },
            { key: "category", label: "Categoría" },
            { key: "amount", label: "Monto" },
            { key: "expectedRange.lower", label: "Rango inferior" },
            { key: "expectedRange.upper", label: "Rango superior" },
            { key: "reason", label: "Señal" },
          ],
          maxRows: 20,
        },
      ],
    },
  };
}

function emptyFallback(id: string, text: string): UiDocument {
  return { version: "1.0", root: { id, type: "alert", severity: "info", text } };
}

function readRows(value: unknown, key: string): Array<Record<string, unknown>> {
  return isRecord(value) && Array.isArray(value[key]) ? value[key].filter(isRecord) : [];
}

function normalizeQuery(query: string): string {
  return query.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

function requestsFinancialHealthExplanation(query: string): boolean {
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  return /(?:salud financiera|diagnostic|evalu.*financ|ahorr|por que.*(?:dinero|finanz|gasto)|no logro)/u.test(normalized);
}

function createLiquidityFallback(source: UiDataSource): UiDocument {
  const transactions = readRows(source.data, "transactions");
  return {
    version: "1.0",
    root: {
      id: "liquidity-explorer",
      type: "tabs",
      tabs: [
        {
          id: "liquidity-pattern",
          label: "Patrón de liquidez",
          children: [
            {
              id: "liquidity-basis",
              type: "alert",
              severity: "info",
              text: "La liquidez mostrada es el flujo neto acumulado dentro de cada mes; no representa el saldo bancario histórico.",
            },
            {
              id: "liquidity-timeline",
              type: "heatmap",
              title: "Liquidez relativa por día del mes",
              data: { sourceId: source.id, path: "timeline" },
              xKey: "month",
              xLabel: "Mes",
              yKey: "dayOfMonth",
              yLabel: "Día del mes",
              valueKey: "relativeLiquidity",
              valueLabel: "Liquidez relativa",
            },
          ],
        },
        {
          id: "preceding-expenses",
          label: "Gastos previos",
          children: [{
            id: "preceding-expenses-table",
            type: "table",
            title: "Gastos en los 7 días anteriores a cada mínimo",
            data: { sourceId: source.id, path: "precedingExpenses" },
            columns: [
              { key: "lowDate", label: "Fecha del mínimo" },
              { key: "transactionDate", label: "Fecha del gasto" },
              { key: "daysBeforeLow", label: "Días antes" },
              { key: "category", label: "Categoría" },
              { key: "description", label: "Descripción" },
              { key: "amount", label: "Monto" },
            ],
            maxRows: 25,
          }],
        },
        ...(transactions.length > 0 ? [{
          id: "liquidity-transactions",
          label: "Movimientos del periodo",
          children: [{
            id: "liquidity-transactions-table",
            type: "table" as const,
            title: "Todos los movimientos del periodo consultado",
            data: { sourceId: source.id, path: "transactions" },
            columns: [
              { key: "transactionDate", label: "Fecha" },
              { key: "description", label: "Descripción" },
              { key: "category", label: "Categoría" },
              { key: "type", label: "Tipo" },
              { key: "amount", label: "Monto" },
              { key: "currency", label: "Moneda" },
            ],
            maxRows: Math.min(transactions.length, 100),
          }],
        }] : []),
      ],
    },
  };
}

function createFinancialHealthFallback(source: UiDataSource): UiDocument {
  const health = readHealthRows(source.data);
  const first = health[0];
  if (!first) {
    return {
      version: "1.0",
      root: {
        id: "financial-health-empty",
        type: "alert",
        severity: "info",
        text: "No hay datos observados suficientes para mostrar la evaluación de salud financiera.",
      },
    };
  }

  const metrics: UiDocument["root"][] = [
    metric("health-score", "Puntuación financiera", source.id, "health.0.score", "percentage"),
    metric("health-status", "Estado", source.id, "health.0.status", "text"),
    metric("liquid-balance", "Saldo líquido", source.id, "health.0.totalLiquidBalance", "currency", "health.0.currency"),
    metric("monthly-margin", "Margen mensual promedio", source.id, "health.0.metrics.averageMonthlyMargin", "currency", "health.0.currency"),
  ];
  if (hasScalar(first.savingsRate)) {
    metrics.push(metric("savings-rate", "Tasa de ahorro", source.id, "health.0.savingsRate", "percentage"));
  }

  return {
    version: "1.0",
    root: {
      id: "financial-health-card",
      type: "card",
      title: "Salud financiera · Datos observados",
      children: metrics,
    },
  };
}

function createPaymentIntentFallback(source: UiDataSource, dataSources: readonly UiDataSource[]): UiDocument {
  const intent = isRecord(source.data) ? source.data : {};
  const account = findPaymentParty(dataSources, "get_accounts", "accounts", intent.sourceAccountId);
  const beneficiary = findPaymentParty(dataSources, "get_beneficiaries", "beneficiaries", intent.beneficiaryId);
  return {
    version: "1.0",
    root: {
      id: "payment-confirmation-card",
      type: "card",
      title: "Confirma tu pago",
      children: [
        ...(account ? [metric("payment-origin", "Cuenta origen", account.source.id, `${account.path}.name`, "text")] : []),
        ...(beneficiary ? [metric("payment-beneficiary", "Beneficiario", beneficiary.source.id, `${beneficiary.path}.name`, "text")] : []),
        metric("payment-amount", "Monto", source.id, "amount", "currency", "currency"),
        ...(typeof intent.concept === "string" && intent.concept ? [metric("payment-concept", "Concepto", source.id, "concept", "text")] : [{ id: "payment-concept", type: "text" as const, text: "Concepto: sin especificar", variant: "body" as const }]),
        metric("payment-fee", "Comisión", source.id, "fee", "currency", "currency"),
        metric("payment-balance-after", "Saldo estimado después", source.id, "estimatedBalanceAfter", "currency", "currency"),
        metric("payment-expiration", "Válido hasta", source.id, "expiresAt", "text"),
        metric("payment-status", "Estado", source.id, "status", "text"),
        {
          id: "payment-warning",
          type: "alert",
          severity: "warning",
          text: "El dinero todavía no se ha movido. Revisa el monto y confirma únicamente si los datos son correctos.",
        },
        {
          id: "confirm-payment",
          type: "button",
          label: "Confirmar pago",
          action: { type: "confirm-payment" },
        },
      ],
    },
  };
}

function findPaymentParty(
  sources: readonly UiDataSource[], toolName: string, key: string, id: unknown,
): { source: UiDataSource; path: string } | undefined {
  for (const source of sources) {
    if (source.toolName !== toolName || !isRecord(source.data) || !Array.isArray(source.data[key])) continue;
    const index = source.data[key].findIndex((row: unknown) => isRecord(row) && row.id === id && typeof row.name === "string");
    if (index >= 0) return { source, path: `${key}.${index}` };
  }
  return undefined;
}

function createPaymentReceiptFallback(source: UiDataSource): UiDocument {
  return {
    version: "1.0",
    root: {
      id: "payment-receipt-card",
      type: "card",
      title: "Pago completado",
      children: [
        metric("receipt-number", "Comprobante", source.id, "receiptNumber", "text"),
        metric("receipt-amount", "Monto", source.id, "amount", "currency", "currency"),
        metric("receipt-fee", "Comisión", source.id, "fee", "currency", "currency"),
        metric("receipt-balance", "Saldo posterior", source.id, "balanceAfter", "currency", "currency"),
        metric("receipt-status", "Estado", source.id, "status", "text"),
      ],
    },
  };
}

function metric(
  id: string,
  label: string,
  sourceId: string,
  path: string,
  format: "currency" | "number" | "percentage" | "text",
  currencyPath?: string,
): UiDocument["root"] {
  return {
    id,
    type: "metric",
    label,
    value: { sourceId, path },
    format,
    ...(currencyPath ? { currencyPath } : {}),
  };
}

function readHealthRows(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.health)) return [];
  return value.health.filter(isRecord);
}

function hasScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
