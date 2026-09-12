import { type UiDataSource, type UiDocument } from "../dsl/ui.schema.js";
import {
  LIQUIDITY_ANALYSIS_SOURCE,
  requiresLiquidityPrecursorAnalysis,
} from "../../agent/reasoning/financial-intent-data-shaper.js";

export function createIntentAwareUiFallback(
  query: string,
  dataSources: readonly UiDataSource[],
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
  return healthSource && requestsFinancialHealthExplanation(query)
    ? createFinancialHealthFallback(healthSource)
    : undefined;
}

function requestsFinancialHealthExplanation(query: string): boolean {
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  return /(?:salud financiera|diagnostic|evalu.*financ|ahorr|por que.*(?:dinero|finanz|gasto)|no logro)/u.test(normalized);
}

function createLiquidityFallback(source: UiDataSource): UiDocument {
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
