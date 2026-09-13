import {
  CONTRACT_VERSION,
  dataRegistryContractSchema,
  uiSpecificationSchema,
  type DataRegistry,
  type UISpecification,
  type UINode,
} from "@banorte/contracts";
import {
  type UiDataReference,
  type UiDataSource,
  type UiDocument,
  type UiNode,
} from "../ui/dsl/ui.schema.js";

interface AdapterContext {
  data: Record<string, unknown>;
  nodeIds: Map<string, string>;
  sourceData: Map<string, unknown>;
  usedNodeIds: Set<string>;
  sourceIds: Map<string, string>;
}

export interface SharedUiPayload {
  specification: UISpecification;
  dataRegistry: DataRegistry;
}

export function adaptUiDataSource(source: UiDataSource, sourceOffset = 0): { key: string; value: unknown } {
  return {
    key: toSharedSourceId(source.id, sourceOffset),
    value: normalizeSourceData(source),
  };
}

export function adaptUiPayload(
  document: UiDocument,
  dataSources: UiDataSource[],
  revision = 0,
  sourceOffset = 0,
): SharedUiPayload {
  const sourceIds = new Map(dataSources.map((source) => [source.id, toSharedSourceId(source.id, sourceOffset)]));
  const context: AdapterContext = {
    data: Object.fromEntries(dataSources.map((source) => [
      requireMappedSourceId(source.id, sourceIds),
      normalizeSourceData(source),
    ])),
    nodeIds: new Map(),
    sourceData: new Map(dataSources.map((source) => [source.id, source.data])),
    usedNodeIds: new Set(),
    sourceIds,
  };
  const specification = uiSpecificationSchema.parse({
    version: CONTRACT_VERSION,
    root: adaptNode(document.root, context),
  });
  const dataRegistry = dataRegistryContractSchema.parse({
    version: CONTRACT_VERSION,
    revision,
    data: context.data,
  });

  return { specification, dataRegistry };
}

function toSharedSourceId(sourceId: string, sourceOffset: number): string {
  const match = /^source-(\d+)$/.exec(sourceId);
  if (!match) throw new SharedContractAdapterError("La fuente no tiene un identificador compatible");
  return `source_${Number(match[1]) + sourceOffset}`;
}

const numericFinancialFields = new Set([
  "absoluteChange",
  "averageMonthlyMargin",
  "amount",
  "availableBalance",
  "balance",
  "balanceAfter",
  "balanceBefore",
  "contribution",
  "currentValue",
  "expenses",
  "estimatedBalanceAfter",
  "estimatedGrowth",
  "fee",
  "income",
  "initialAmount",
  "interestEarned",
  "interestPaid",
  "largestExpense",
  "largestIncome",
  "netCashFlow",
  "paymentAmount",
  "periodicContribution",
  "precedingExpenseTotal",
  "principalPaid",
  "projectedBalance",
  "previousValue",
  "relativeLiquidity",
  "remainingBalance",
  "totalContributions",
  "totalExpenses",
  "totalIncome",
  "totalInterest",
  "totalLiquidBalance",
  "totalPaid",
]);
const percentageFinancialFields = new Set([
  "expenseToIncomeRatio",
  "percentage",
  "percentageChange",
  "savingsRate",
  "score",
]);
const privateFieldPattern = /(?:^|_)(?:id|uuid|token|secret|password|user|owner|idempotency)(?:_|$)|(?:Id|ID|Uuid|UUID)$|^idempotencyKey$/u;
const financialValueLabels: Record<string, Record<string, string>> = {
  category: {
    education: "Educación",
    entertainment: "Entretenimiento",
    food: "Alimentación",
    groceries: "Supermercado",
    health: "Salud",
    housing: "Vivienda",
    income: "Ingresos",
    other: "Otros",
    restaurants: "Restaurantes",
    salary: "Salario",
    shopping: "Compras",
    subscriptions: "Suscripciones",
    transport: "Transporte",
    transfers: "Transferencias",
    travel: "Viajes",
    utilities: "Servicios",
  },
  type: { expense: "Gasto", income: "Ingreso", payment: "Pago", transfer: "Transferencia" },
};

function normalizeSourceData(source: UiDataSource): unknown {
  const normalized = normalizeFinancialValues(source.data);
  const dataType = source.toolName === "simulate_loan" || source.toolName === "simulate_savings"
    ? "SIMULATED"
    : "OBSERVED";
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return { ...(normalized as Record<string, unknown>), dataType };
  }
  return { dataType, value: normalized };
}

type FinancialNumericSemantic = "currency" | "percentage";

function normalizeFinancialValues(
  value: unknown,
  field?: string,
  inheritedSemantic?: FinancialNumericSemantic,
): unknown {
  const semantic: FinancialNumericSemantic | undefined = percentageFinancialFields.has(field ?? "")
    ? "percentage"
    : inheritedSemantic ?? (numericFinancialFields.has(field ?? "") ? "currency" : undefined);
  if (typeof value === "string" && field) {
    const label = financialValueLabels[field]?.[value.toLowerCase()];
    if (label) return label;
  }
  if ((typeof value === "string" || typeof value === "number") && semantic === "percentage") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number((numeric / 100).toFixed(6)) : value;
  }
  if (typeof value === "string" && semantic === "currency") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeFinancialValues(item, undefined, semantic));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !privateFieldPattern.test(key))
      .map(([key, item]) => [key, normalizeFinancialValues(item, key, semantic)]));
  }
  return value;
}

function adaptTableColumn(column: { key: string; label: string }) {
  const field = column.key.split(".").at(-1) ?? column.key;
  if (percentageFinancialFields.has(field)) {
    return { field: column.key, label: column.label, format: "percentage" as const, align: "end" as const };
  }
  if (numericFinancialFields.has(field)) {
    return { field: column.key, label: column.label, format: "currency" as const, align: "end" as const };
  }
  if (field === "transaction_count" || /(?:Count|count|dayOfMonth|daysBeforeLow)$/u.test(field)) {
    return { field: column.key, label: column.label, format: "number" as const, align: "end" as const };
  }
  if (/(?:Date|date|At|periodStart|periodEnd)$/u.test(field)) {
    return { field: column.key, label: column.label, format: "date" as const };
  }
  return { field: column.key, label: column.label };
}

function adaptNode(node: UiNode, context: AdapterContext): UINode {
  const id = getNodeId(node.id, context);

  switch (node.type) {
    case "dashboard":
      return { type: "section", id, ariaLabel: node.title, surface: "primary", children: node.children.map((child) => adaptNode(child, context)) };
    case "stack":
      return { type: "flex", id, direction: node.direction === "horizontal" ? "row" : "column", gap: "md", children: node.children.map((child) => adaptNode(child, context)) };
    case "grid":
      return { type: "grid", id, columns: normalizeColumnCount(node.columnCount), gap: "md", children: node.children.map((child) => adaptNode(child, context)) };
    case "card":
      return { type: "section", id, ariaLabel: node.title ?? "Contenido financiero", surface: "elevated", padding: "md", children: node.children.map((child) => adaptNode(child, context)) };
    case "text":
      return node.variant === "title" || node.variant === "subtitle"
        ? { type: "heading", id, content: node.text, level: node.variant === "title" ? 2 : 3 }
        : { type: "text", id, content: node.text, variant: node.variant === "caption" ? "caption" : "body" };
    case "metric":
      return { type: "metric", id, label: node.label, valueBinding: adaptReference(node.value, context), format: node.format === "percentage" ? "percent" : node.format };
    case "chart":
      return adaptChart(node, id, context);
    case "heatmap":
      return {
        type: "visualization",
        id,
        ariaLabel: node.title,
        mark: "heatmap",
        dataBinding: adaptReference(node.data, context),
        encoding: {
          x: { field: node.xKey, type: "nominal", label: node.xLabel },
          y: { field: node.yKey, type: "ordinal", label: node.yLabel },
          value: { field: node.valueKey, type: "quantitative", label: node.valueLabel },
        },
        legend: { show: true, position: "top" },
      };
    case "table":
      return adaptTable(node, id, context);
    case "form":
      return {
        type: "stack",
        id,
        gap: "md",
        children: [
          { type: "heading", content: node.title, level: 3 },
          ...node.fields.map((field) => adaptField(field, context, /(?:revis|prepar).*pago/iu.test(node.submitLabel))),
          { type: "button", id: getNodeId(`${node.id}-submit`, context), label: node.submitLabel, event: "form.submit" },
        ],
      };
    case "filters":
      return {
        type: "stack",
        id,
        gap: "md",
        children: node.fields.map((field) => adaptFilter(field, context)),
      };
    case "tabs":
      return {
        type: "tabs",
        id,
        ariaLabel: "Secciones financieras",
        ...(node.tabs[0] ? { defaultValue: node.tabs[0].id } : {}),
        items: node.tabs.map((tab) => ({ value: tab.id, label: tab.label, children: tab.children.map((child) => adaptNode(child, context)) })),
      };
    case "alert":
      return { type: "alert", id, message: node.text, semanticState: `status.${node.severity}` };
    case "button":
      return { type: "button", id, label: node.label, event: adaptActionName(node.action.type) };
    case "slider":
      return {
        type: "slider",
        id,
        label: node.label,
        event: "simulation.changed",
        min: node.min,
        max: node.max,
        step: node.step,
        initialValue: node.initialValue,
        showValue: node.showValue,
      };
  }
}

function adaptTable(
  node: Extract<UiNode, { type: "table" }>,
  id: string,
  context: AdapterContext,
): UINode {
  const rows = resolveSourceRows(node.data, context);
  const dataBinding = node.maxRows < 10
    ? createLimitedCollectionBinding(node.data, node.maxRows, id, context)
    : adaptReference(node.data, context);
  const columns = node.columns.map(adaptTableColumn);

  return {
    type: "table",
    id,
    ariaLabel: node.title,
    dataBinding,
    columns,
    ...(rows.length > 1 ? {
      sorting: { enabled: true },
      filtering: { enabled: true, fields: columns.map((column) => column.field) },
    } : {}),
    pagination: { pageSize: normalizePageSize(node.maxRows) },
  };
}

function createLimitedCollectionBinding(
  reference: UiDataReference,
  maxRows: number,
  nodeId: string,
  context: AdapterContext,
): string {
  const rows = resolveSourceRows(reference, context);
  const dataBinding = `${requireSourceId(reference.sourceId, context)}_${nodeId.replaceAll("-", "_")}_rows`;
  context.data[dataBinding] = normalizeFinancialValues(rows.slice(0, maxRows));
  return dataBinding;
}

function adaptChart(
  node: Extract<UiNode, { type: "chart" }>,
  id: string,
  context: AdapterContext,
): UINode {
  const series = node.series[0];
  if (!series) throw new SharedContractAdapterError("La gráfica no contiene series");
  if (node.series.length > 1) {
    return adaptMultiSeriesChart(node, id, context);
  }

  if (node.chartType === "pie") {
    return {
      type: "visualization",
      id,
      ariaLabel: node.title,
      mark: "donut",
      dataBinding: adaptReference(node.data, context),
      encoding: {
        group: { field: node.categoryKey, type: "nominal", label: node.title },
        value: { field: series.key, type: "quantitative", label: series.label },
      },
    };
  }

  return {
    type: "visualization",
    id,
    ariaLabel: node.title,
    mark: node.chartType,
    dataBinding: adaptReference(node.data, context),
    encoding: {
      x: { field: node.categoryKey, type: "nominal" },
      y: { field: series.key, type: "quantitative", label: series.label },
    },
  };
}

function adaptMultiSeriesChart(
  node: Extract<UiNode, { type: "chart" }>,
  id: string,
  context: AdapterContext,
): UINode {
  if (node.chartType === "pie") {
    throw new SharedContractAdapterError("Una gráfica circular no admite múltiples series");
  }
  const rows = resolveSourceRows(node.data, context);
  const dataBinding = `${requireSourceId(node.data.sourceId, context)}_${id.replaceAll("-", "_")}`;
  context.data[dataBinding] = rows.flatMap((row) => node.series.map((series) => ({
    category: normalizeFinancialValues(row[node.categoryKey] ?? "—", node.categoryKey),
    series: series.label,
    value: normalizeFinancialValues(row[series.key], series.key),
  })));

  return {
    type: "visualization",
    id,
    ariaLabel: node.title,
    mark: node.chartType === "bar" ? "grouped-bar" : "line",
    dataBinding,
    encoding: {
      x: { field: "category", type: "nominal" },
      y: { field: "value", type: "quantitative" },
      group: { field: "series", type: "nominal" },
    },
    legend: { show: true, position: "top" },
  };
}

function resolveSourceRows(reference: UiDataReference, context: AdapterContext): Array<Record<string, unknown>> {
  let value = context.sourceData.get(reference.sourceId);
  for (const segment of reference.path?.split(".") ?? []) {
    if (Array.isArray(value)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= value.length) {
        throw new SharedContractAdapterError("La interfaz referencia datos incompatibles");
      }
      value = value[index];
      continue;
    }
    if (!value || typeof value !== "object") {
      throw new SharedContractAdapterError("La interfaz referencia datos incompatibles");
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new SharedContractAdapterError("La interfaz requiere una colección de registros");
  }
  return value as Array<Record<string, unknown>>;
}

function adaptField(
  field: Extract<UiNode, { type: "form" }>["fields"][number],
  context: AdapterContext,
  paymentReviewForm: boolean,
): UINode {
  const id = getNodeId(field.id, context);
  if (field.type === "date") return { type: "datePicker", id, label: field.label, event: "form.value.changed" };
  if (field.type === "select") return { type: "select", id, label: field.label, event: "form.value.changed", options: field.options, required: true, placeholder: "Selecciona una opción", ...(field.initialValue ? { initialValue: field.initialValue } : {}) };
  const required = paymentReviewForm && /^(?:monto|importe|cantidad|moneda)\b/iu.test(field.label.trim());
  return { type: "input", id, label: field.label, event: "form.value.changed", placeholder: field.placeholder, validation: { maxLength: field.maxLength, ...(required ? { required: true } : {}) }, ...(field.initialValue ? { initialValue: field.initialValue } : {}) };
}

function adaptFilter(
  field: Extract<UiNode, { type: "filters" }>["fields"][number],
  context: AdapterContext,
): UINode {
  const id = getNodeId(field.id, context);
  return field.type === "date-range"
    ? { type: "dateRange", id, label: field.label, event: "filters.value.changed", initialValue: field.initialValue }
    : { type: "select", id, label: field.label, event: "filters.value.changed", options: field.options };
}

function adaptReference(reference: UiDataReference, context: AdapterContext): string {
  const sourceId = requireSourceId(reference.sourceId, context);
  return reference.path ? `${sourceId}.${reference.path}` : sourceId;
}

function requireSourceId(sourceId: string, context: AdapterContext): string {
  return requireMappedSourceId(sourceId, context.sourceIds);
}

function requireMappedSourceId(sourceId: string, sourceIds: Map<string, string>): string {
  const mapped = sourceIds.get(sourceId);
  if (!mapped) throw new SharedContractAdapterError("La interfaz referencia una fuente inexistente");
  return mapped;
}

function getNodeId(originalId: string, context: AdapterContext): string {
  const existing = context.nodeIds.get(originalId);
  if (existing) return existing;
  const normalized = normalizeNodeId(originalId);
  let candidate = normalized;
  let suffix = 2;
  while (context.usedNodeIds.has(candidate)) {
    candidate = `${normalized.slice(0, 61)}-${suffix}`;
    suffix += 1;
  }
  context.nodeIds.set(originalId, candidate);
  context.usedNodeIds.add(candidate);
  return candidate;
}

function normalizeNodeId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const prefixed = /^[a-z]/.test(normalized) ? normalized : `node-${normalized}`;
  return (prefixed || "node").slice(0, 64).replace(/-+$/g, "");
}

function normalizePageSize(maxRows: number): 10 | 25 | 50 | 100 {
  if (maxRows <= 10) return 10;
  if (maxRows <= 25) return 25;
  if (maxRows <= 50) return 50;
  return 100;
}

function normalizeColumnCount(columnCount: number): 1 | 2 | 3 | 4 {
  if (columnCount === 1 || columnCount === 2 || columnCount === 3) return columnCount;
  return 4;
}

function adaptActionName(action: "refresh" | "confirm-payment" | "apply-filters" | "submit-form" | "select-tab"): string {
  if (action === "refresh") return "ui.refresh";
  if (action === "confirm-payment") return "payment.confirmed";
  return action.replaceAll("-", ".");
}

export class SharedContractAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedContractAdapterError";
  }
}
