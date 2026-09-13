import {
  resolveUiDataReference,
  type UiDataSource,
  type UiDocument,
  type UiNode,
} from "../dsl/ui.schema.js";
import {
  LIQUIDITY_ANALYSIS_SOURCE,
  requiresLiquidityPrecursorAnalysis,
} from "../../agent/reasoning/financial-intent-data-shaper.js";
import { categoryIdentity, selectedComparisonCategories } from "../../agent/reasoning/personal-category-selection.js";
import { containsUnsupportedNegativeAnomalyClaim } from "../../agent/reasoning/anomaly-claim.js";

export interface SemanticUiIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export interface SemanticUiValidationOptions {
  enforcePersonalBankingComposition?: boolean;
}

export type SemanticUiValidationResult =
  | { success: true; issues: [] }
  | { success: false; issues: SemanticUiIssue[] };

interface ExplicitUiRequirements {
  exactCharts?: number;
  exactMetrics?: number;
  forbidCharts: boolean;
  forbidDashboard: boolean;
  forbidTables: boolean;
  maxCollectionItems?: number;
  requireChart: boolean;
  requireDateRange: boolean;
  requireInteraction: boolean;
  requireSlider: boolean;
  requireNotesField: boolean;
  requireTable: boolean;
}

export function validateUiSemantics(
  query: string,
  document: UiDocument,
  dataSources: UiDataSource[],
  options: SemanticUiValidationOptions = {},
): SemanticUiValidationResult {
  const latestRequest = latestUiRequest(query);
  const requirements = extractExplicitUiRequirements(latestRequest);
  const nodes = collectNodes(document.root);
  const issues: SemanticUiIssue[] = [];
  const charts = nodes.filter((node) => node.type === "chart");
  const heatmaps = nodes.filter((node) => node.type === "heatmap");
  const visualizations = [...charts, ...heatmaps];
  const metrics = nodes.filter((node) => node.type === "metric");
  const tables = nodes.filter((node) => node.type === "table");
  const normalizedRequest = normalizeText(latestRequest);
  const wantsPaymentCapture = /\b(?:prepara|preparar|revisar)\b.{0,90}\bpago\b/u.test(normalizedRequest)
    && !dataSources.some((source) => source.toolName === "create_payment_intent" || source.toolName === "confirm_payment")
    && dataSources.some((source) => source.toolName === "get_accounts")
    && dataSources.some((source) => source.toolName === "get_beneficiaries");
  if (wantsPaymentCapture && !nodes.some((node) => node.type === "form"
    && /revis/u.test(normalizeText(node.submitLabel))
    && node.fields.some((field) => /origen/u.test(normalizeText(field.label)))
    && node.fields.some((field) => /beneficiario|destinatario|destino/u.test(normalizeText(field.label))))) {
    issues.push({ code: "payment_capture_required", message: "El pago para revisión requiere formulario editable con origen y beneficiario; no basta un resumen textual" });
  }
  const requestsGuidance = /(?:recomienda|recomendar|recomendaciones|ajustes razonables|por que no logro ahorrar|no puedo reducir|gastos intocables)/u.test(normalizedRequest);
  if (requestsGuidance && dataSources.some((source) => source.toolName === "evaluate_financial_health")
    && !nodes.some((node) => (node.type === "text" || node.type === "alert")
      && /(?:recomend|ajust|propon|podrias|intocable|insuficient|no hay datos)/u.test(normalizeText(node.text)))) {
    issues.push({ code: "education_guidance_required", message: "La solicitud educativa requiere explicación y recomendaciones visibles, o una limitación explícita de datos" });
  }

  if (requirements.forbidDashboard) rejectNodes(nodes, "dashboard", "dashboard_forbidden", "La solicitud excluye dashboards", issues);
  if (requirements.forbidTables) rejectNodes(nodes, "table", "table_forbidden", "La solicitud excluye tablas", issues);
  if (requirements.forbidCharts) {
    rejectNodes(nodes, "chart", "chart_forbidden", "La solicitud excluye gráficas", issues);
    rejectNodes(nodes, "heatmap", "chart_forbidden", "La solicitud excluye gráficas", issues);
  }
  if (requirements.requireTable && tables.length === 0) {
    issues.push({ code: "table_required", message: "La solicitud requiere una tabla" });
  }
  if (requirements.requireChart && visualizations.length === 0) {
    issues.push({ code: "chart_required", message: "La solicitud requiere una visualización de tendencia" });
  }
  if (requirements.requireDateRange && !hasDateRange(nodes)) {
    issues.push({ code: "date_range_required", message: "La solicitud requiere un control para cambiar el periodo" });
  }
  if (requirements.requireSlider && !nodes.some((node) => node.type === "slider")) {
    issues.push({ code: "slider_required", message: "La solicitud requiere un slider" });
  }
  if (requirements.requireNotesField && !nodes.some((node) => node.type === "form"
    && node.fields.some((field) => field.type === "text"
      && /(?:nota|comentario|observacion)/u.test(normalizeText(`${node.title} ${field.label}`))))) {
    issues.push({ code: "notes_field_required", message: "La solicitud requiere un campo editable para notas" });
  }
  if (requirements.requireInteraction && !nodes.some(isInteractionNode)) {
    issues.push({ code: "interaction_required", message: "La solicitud requiere una interfaz interactiva" });
  }
  if (
    requirements.forbidDashboard
    && !nodes.some((node) => node.type === "tabs")
    && isDashboardLike(metrics.length, visualizations.length, tables.length)
  ) {
    issues.push({ code: "dashboard_composition_forbidden", message: "La composición sigue teniendo estructura de dashboard" });
  }
  validateExactCount("chart", visualizations, requirements.exactCharts, "chart_count_mismatch", issues);
  validateExactCount("metric", metrics, requirements.exactMetrics, "metric_count_mismatch", issues);
  validateLiquidityEvidenceBindings(latestRequest, nodes, dataSources, issues);
  validatePaymentConfirmation(nodes, dataSources, issues);
  validatePaymentReceipt(nodes, dataSources, issues);
  validatePaymentCaptureBindings(normalizedRequest, nodes, dataSources, issues);
  validatePaymentNarrative(normalizedRequest, nodes, dataSources, issues);
  if (options.enforcePersonalBankingComposition) {
    validatePersonalBankingGrounding(normalizedRequest, nodes, dataSources, tables, visualizations, issues);
  }
  if (/\bcomercios?\b/u.test(normalizedRequest)
    && dataSources.some((source) => source.toolName === "get_transactions")) {
    const narrative = nodes.flatMap((node) => node.type === "text" || node.type === "alert" ? [normalizeText(node.text)] : []);
    if (!narrative.some((value) => /(?:no (?:hay|cuento con|se (?:identifican|incluyen|registran))|sin).{0,100}(?:comercios?|establecimientos?|nombres? verificados?|identidad)/u.test(value)
      || /(?:descripcion|concepto).{0,100}(?:no (?:identifica|equivale|permite)|sin verificar)/u.test(value))) {
      issues.push({ code: "merchant_identity_disclosure_required", message: "La UI debe explicar que las descripciones de movimientos no identifican comercios verificados" });
    }
    if (tables.some((table) => table.type === "table" && table.columns.some((column) =>
      column.key === "description" && /comercio/u.test(normalizeText(column.label))))) {
      issues.push({ code: "merchant_column_mislabelled", message: "La columna description debe llamarse Concepto o Descripción, no Comercio" });
    }
    const anomalyIds = new Set(dataSources.filter((source) => source.toolName === "detect_transaction_anomalies").map((source) => source.id));
    if (nodes.some((node) => (node.type === "table" || node.type === "chart" || node.type === "heatmap")
      && anomalyIds.has(node.data.sourceId))) {
      issues.push({ code: "irrelevant_anomaly_evidence", message: "La pregunta por comercios no solicita una evaluación de anomalías" });
    }
  }

  for (const node of [...visualizations, ...tables]) {
    const rows = resolveUiDataReference(node.data, dataSources);
    if (!Array.isArray(rows) || rows.length === 0) {
      issues.push({ code: "empty_collection", message: "La visualización no contiene filas visibles", nodeId: node.id });
      continue;
    }
    if (requirements.maxCollectionItems !== undefined) {
      const visibleRows = node.type === "table" ? Math.min(rows.length, node.maxRows) : rows.length;
      if (visibleRows > requirements.maxCollectionItems) {
        issues.push({
          code: "collection_limit_exceeded",
          message: `La solicitud limita el resultado a ${requirements.maxCollectionItems} elementos`,
          nodeId: node.id,
        });
      }
    }
    if (
      (node.type === "chart" && !hasVisibleChartValue(node, rows))
      || (node.type === "heatmap" && !hasVisibleHeatmapValue(node, rows))
    ) {
      issues.push({ code: "empty_chart", message: "La gráfica no contiene valores visibles", nodeId: node.id });
    }
  }

  for (const metric of metrics) {
    const value = resolveUiDataReference(metric.value, dataSources);
    if (value === null || value === undefined || value === "") {
      issues.push({ code: "empty_metric", message: "La métrica no contiene un valor visible", nodeId: metric.id });
    }
  }

  return issues.length === 0 ? { success: true, issues: [] } : { success: false, issues };
}

/**
 * Grounding checks for read-only personal banking. Layout is the planner's
 * decision; only misleading or missing evidence is rejected here.
 */
function validatePersonalBankingGrounding(
  request: string,
  nodes: UiNode[],
  sources: UiDataSource[],
  tables: UiNode[],
  visualizations: UiNode[],
  issues: SemanticUiIssue[],
): void {
  const hasPaymentFlow = sources.some((source) => source.toolName === "create_payment_intent" || source.toolName === "confirm_payment");
  if (hasPaymentFlow) return;

  const source = (toolName: string) => sources.find((candidate) => candidate.toolName === toolName);
  const nonEmpty = (toolName: string, key: string) => readSourceRows(source(toolName)?.data, key).length > 0;
  if (source("compare_periods") && nonEmpty("compare_periods", "comparisons")) {
    const comparisonSource = [...sources].reverse().find((candidate) => candidate.toolName === "compare_periods");
    const comparisons = readSourceRows(comparisonSource?.data, "comparisons");
    const firstComparison = comparisons[0];
    const categories = isRecord(firstComparison) ? readSourceRows(firstComparison, "categories") : [];
    const selected = selectedComparisonCategories(request, categories.flatMap((row) =>
      isRecord(row) && typeof row.category === "string" ? [row.category] : []));
    if (selected) {
      const expected = new Set(selected);
      const categoryCollections: string[][] = [];
      const transactionCategories: string[] = [];
      for (const node of [...tables, ...visualizations]) {
        if (node.type !== "table" && node.type !== "chart" && node.type !== "heatmap") continue;
        const rows = resolveUiDataReference(node.data, sources);
        if (!Array.isArray(rows)) continue;
        const visibleRows = (node.type === "table" ? rows.slice(0, node.maxRows) : rows).filter(isRecord);
        const visibleCategories = visibleRows
          .flatMap((row) => typeof row.category === "string" ? [categoryIdentity(row.category)] : []);
        if (visibleCategories.length === 0) continue;
        const isTransactionDetail = visibleRows.some((row) =>
          "transactionDate" in row || "description" in row || "transactionId" in row);
        if (isTransactionDetail) transactionCategories.push(...visibleCategories);
        else categoryCollections.push(visibleCategories);
      }
      const aggregateMismatch = categoryCollections.some((visible) =>
        visible.some((category) => !expected.has(category))
        || [...expected].some((category) => !visible.includes(category)));
      const transactionMismatch = transactionCategories.length > 0 && (
        transactionCategories.some((category) => !expected.has(category))
        || [...expected].some((category) => !transactionCategories.includes(category))
      );
      if ((categoryCollections.length === 0 && transactionCategories.length === 0)
        || aggregateMismatch
        || transactionMismatch) {
        issues.push({
          code: "personal_category_filter_mismatch",
          message: "Las categorías agregadas deben mostrar exactamente la selección solicitada; los movimientos pueden separarse en varias tablas siempre que en conjunto cubran esa selección sin categorías adicionales.",
        });
      }
    }
  }

  const anomalySource = source("detect_transaction_anomalies");
  const anomalyMetadata = isRecord(anomalySource?.data) && isRecord(anomalySource.data.metadata)
    ? anomalySource.data.metadata : undefined;
  const anomalyRelevant = /\b(?:anomalias?|atipic[oa]s?|inusual(?:es)?|fuera de lo habitual)\b/u.test(request)
    || nodes.some((node) => (node.type === "table" || node.type === "chart" || node.type === "heatmap" || node.type === "metric")
      && ("data" in node ? node.data.sourceId === anomalySource?.id : "value" in node && node.value.sourceId === anomalySource?.id));
  if (anomalyRelevant && anomalyMetadata?.eligibleGroups === 0) {
    const visibleText = nodes.flatMap((node) => node.type === "alert" || node.type === "text" ? [normalizeText(node.text)] : []);
    if (!visibleText.some((value) => /muestra insuficiente|datos insuficientes|grupos? no evaluables?/u.test(value))
      || visibleText.some(containsUnsupportedNegativeAnomalyClaim)) {
      issues.push({
        code: "personal_anomaly_sample_disclosure_required",
        message: "Con cero grupos elegibles, la UI debe indicar muestra insuficiente y no afirmar ausencia de anomalías.",
      });
    }
  }

  if (/\btransferencias?\b/u.test(request)) {
    const filteredTransferSource = [...sources].reverse().find((candidate) => candidate.toolName === "get_transactions"
      && isRecord(candidate.data)
      && isRecord(candidate.data.metadata)
      && isRecord(candidate.data.metadata.appliedFilters)
      && candidate.data.metadata.appliedFilters.transactionType === "transfer");
    const transferSources = sources.filter((candidate) => candidate.toolName === "get_transactions"
      && isRecord(candidate.data)
      && readSourceRows(candidate.data, "transactions").some((row) => isRecord(row) && row.type === "transfer"));
    if (transferSources.length > 0 && !tables.some((table) => {
      if (table.type !== "table") return false;
      const rows = resolveUiDataReference(table.data, sources);
      return Array.isArray(rows) && rows.slice(0, table.maxRows).some((row) => isRecord(row) && row.type === "transfer");
    })) {
      issues.push({
        code: "personal_transfer_history_table_required",
        message: "El análisis de transferencias históricas debe mostrar los movimientos de transferencia observados en una tabla, no sólo saldos agregados.",
      });
    }
    if (filteredTransferSource && readSourceRows(filteredTransferSource.data, "transactions").length === 0
      && (tables.length > 0 || !nodes.some((node) => (node.type === "alert" || node.type === "text")
        && /no (?:hay|se registraron|se encontraron) transferencias|sin transferencias registradas/u.test(normalizeText(node.text))))) {
      issues.push({
        code: "personal_transfer_history_empty_state_required",
        message: "Si la consulta filtrada no devuelve transferencias, muestra un estado vacío explícito; no sustituyas la evidencia con una tabla de saldos.",
      });
    }
  }

}

function readSourceRows(value: unknown, key: string): unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function validatePaymentCaptureBindings(request: string, nodes: UiNode[], sources: UiDataSource[], issues: SemanticUiIssue[]): void {
  const catalogs = new Map<string, Array<Record<string, unknown>>>();
  for (const [toolName, key] of [["get_accounts", "accounts"], ["get_beneficiaries", "beneficiaries"]] as const) {
    const source = sources.find((candidate) => candidate.toolName === toolName);
    catalogs.set(key, source && isRecord(source.data) && Array.isArray(source.data[key]) ? source.data[key].filter(isRecord) : []);
  }
  for (const node of nodes) {
    if (node.type !== "form") continue;
    for (const field of node.fields) {
      if (field.type !== "select") continue;
      const role = /origen|cuenta de debito/u.test(normalizeText(field.label)) ? "accounts"
        : /beneficiario|destinatario|destino/u.test(normalizeText(field.label)) ? "beneficiaries" : undefined;
      if (!role || !sources.some((source) => source.toolName === (role === "accounts" ? "get_accounts" : "get_beneficiaries"))) continue;
      const rows = catalogs.get(role)!;
      for (const option of field.options) {
        const matched = rows.filter((row) => row.id === option.value && typeof row.name === "string"
          && normalizeText(option.label).includes(normalizeText(row.name))
          && row.status === "active"
          && (role !== "accounts" || row.type !== "credit_card"));
        if (matched.length !== 1) issues.push({ code: "payment_option_unverified", nodeId: node.id,
          message: "Cada opción de origen/beneficiario debe usar el UUID y nombre verificados de get_accounts/get_beneficiaries; no incluyas tarjetas como origen" });
      }
      if (field.initialValue) {
        const row = rows.find((item) => item.id === field.initialValue);
        if (!field.options.some((option) => option.value === field.initialValue)
          || !row || typeof row.name !== "string" || !request.includes(normalizeText(row.name))) {
          issues.push({ code: "payment_prefill_unverified", nodeId: node.id,
            message: "Sólo precargues una opción verificada y nombrada explícitamente por el usuario" });
        }
      }
    }
  }
}

// Account.balance is not evidence of outstanding debt. Nor is conversational
// history an authoritative source for an observed category amount.
function validatePaymentNarrative(
  request: string,
  nodes: UiNode[],
  sources: UiDataSource[],
  issues: SemanticUiIssue[],
): void {
  if (!/\bpago\b/u.test(request) || sources.some((source) => source.toolName === "confirm_payment")) return;
  const spending = sources.filter((source) => source.toolName === "get_spending_by_category");
  const categoryAmounts = new Map<string, Set<number>>();
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!isRecord(value)) return;
    if (typeof value.category === "string" && Number.isFinite(Number(value.amount))) {
      const category = normalizeText(value.category);
      const key = /^(?:housing|rent|vivienda|renta)$/u.test(category) ? "housing"
        : /^(?:transport|transportation|transporte)$/u.test(category) ? "transport" : undefined;
      if (key) {
        const amounts = categoryAmounts.get(key) ?? new Set<number>();
        amounts.add(Number(value.amount));
        categoryAmounts.set(key, amounts);
      }
    }
    Object.values(value).forEach(inspect);
  };
  spending.forEach((source) => inspect(source.data));
  for (const node of nodes) {
    if (node.type !== "text" && node.type !== "alert") continue;
    const text = normalizeText(node.text);
    if (/\b(?:margen|excedente)\b/u.test(text)
      && /(?:pasaria|quedaria|restaria|despues del pago|tras el pago)/u.test(text)
      && /\$\s*\d/u.test(text) && !/\bsimulated\b/u.test(text)) {
      issues.push({ code: "payment_projection_label_required", nodeId: node.id,
        message: "Etiqueta como SIMULATED el impacto hipotético sobre margen/excedente y aclara que no se ha movido dinero." });
    }
    for (const sentence of text.split(/(?<!\d)[.;\n]|[.;](?!\d)/u)) {
      if (/\b(?:deuda|amortizacion)\b|(?:saldo|balance).*tarjeta|tarjeta.*(?:saldo|balance)/u.test(sentence)
        && /(?:disminuy|reduc|restante|quedaria|amortiz|deuda (?:de|a|por)\s*\$)/u.test(sentence)
        && !/\b(?:no|sin|desconoc|no comprob|no verific)/u.test(sentence)) {
        issues.push({ code: "payment_debt_unverified", nodeId: node.id,
          message: "No calcules deuda ni amortización: get_accounts.balance no acredita deuda de tarjeta. Explica la limitación sin cifras de deuda." });
      }
    }
    for (const match of text.matchAll(/\b(renta|vivienda|transporte)\b\s*(?:[:=]|de|por|\()?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gu)) {
      const key = match[1] === "transporte" ? "transport" : "housing";
      if (!categoryAmounts.get(key)?.has(Number(match[2]!.replaceAll(",", "")))) {
        issues.push({ code: "payment_category_amount_unverified", nodeId: node.id,
          message: "Omite importes de renta/transporte en la narrativa de pago si no están comprobados por get_spending_by_category. Conserva las categorías intocables sin inventar cifras." });
      }
    }
  }
}

function validatePaymentConfirmation(
  nodes: UiNode[],
  dataSources: UiDataSource[],
  issues: SemanticUiIssue[],
): void {
  const hasPendingIntent = dataSources.some((source) => (
    source.toolName === "create_payment_intent"
    && isRecord(source.data)
    && source.data.status === "awaiting_confirmation"
  ));
  if (hasPendingIntent) {
    const intent = dataSources.find((source) => source.toolName === "create_payment_intent" && isRecord(source.data));
    const details = ["amount", "fee", "estimatedBalanceAfter", "expiresAt"];
    for (const path of details) {
      if (!nodes.some((node) => node.type === "metric" && node.value.sourceId === intent?.id && node.value.path === path)) {
        issues.push({ code: "payment_review_incomplete", message: `La revisión debe mostrar ${path} enlazado al intent verificado` });
      }
    }
    if (isRecord(intent?.data) && intent.data.concept && !nodes.some((node) => node.type === "metric"
      && node.value.sourceId === intent.id && node.value.path === "concept")) {
      issues.push({ code: "payment_review_incomplete", message: "La revisión debe mostrar el concepto verificado" });
    }
    for (const [toolName, key, idField] of [["get_accounts", "accounts", "sourceAccountId"], ["get_beneficiaries", "beneficiaries", "beneficiaryId"]] as const) {
      const source = dataSources.find((candidate) => candidate.toolName === toolName);
      const rows = source && isRecord(source.data) && Array.isArray(source.data[key]) ? source.data[key] : [];
      const index = rows.findIndex((row: unknown) => isRecord(row) && row.id === (intent?.data as Record<string, unknown>)[idField]);
      if (index < 0 || !nodes.some((node) => node.type === "metric" && node.value.sourceId === source?.id
        && node.value.path === `${key}.${index}.name`)) {
        issues.push({ code: "payment_review_incomplete", message: `La revisión debe identificar ${toolName === "get_accounts" ? "la cuenta origen" : "el beneficiario"} con datos verificados` });
      }
    }
    if (nodes.some((node) => node.type === "form")) {
      issues.push({ code: "payment_review_incomplete", message: "No muestres captura editable cuando ya existe un intent pendiente" });
    }
  }
  const confirmationButtons = nodes.filter((node) => (
    node.type === "button" && node.action.type === "confirm-payment"
  ));
  if (hasPendingIntent && confirmationButtons.length !== 1) {
    issues.push({
      code: "payment_confirmation_required",
      message: "Un pago pendiente requiere exactamente un botón de confirmación explícita.",
    });
  }
  if (!hasPendingIntent && confirmationButtons.length > 0) {
    issues.push({
      code: "payment_confirmation_forbidden",
      message: "No se puede mostrar confirmación sin un intent de pago pendiente.",
    });
  }
}

function validatePaymentReceipt(nodes: UiNode[], sources: UiDataSource[], issues: SemanticUiIssue[]): void {
  const receipt = sources.find((source) => source.toolName === "confirm_payment" && isRecord(source.data)
    && source.data.status === "succeeded");
  if (!receipt) return;
  if (nodes.some((node) => node.type === "form" || (node.type === "button" && node.action.type === "confirm-payment"))) {
    issues.push({ code: "payment_receipt_required", message: "Después de confirmar, elimina captura y botón de confirmación" });
  }
  for (const path of ["receiptNumber", "amount", "balanceAfter", "status"]) {
    if (!nodes.some((node) => node.type === "metric" && node.value.sourceId === receipt.id && node.value.path === path)) {
      issues.push({ code: "payment_receipt_required", message: `El comprobante debe mostrar ${path} desde confirm_payment` });
    }
  }
  if (nodes.some((node) => node.type === "metric" && /estimad/u.test(normalizeText(node.label)))) {
    issues.push({ code: "payment_receipt_required", message: "No presentes como estimado un saldo ya confirmado" });
  }
}

function validateLiquidityEvidenceBindings(
  query: string,
  nodes: UiNode[],
  dataSources: UiDataSource[],
  issues: SemanticUiIssue[],
) {
  if (!requiresLiquidityPrecursorAnalysis(query)) return;
  const source = dataSources.find((candidate) => candidate.toolName === LIQUIDITY_ANALYSIS_SOURCE);
  if (!source) return;

  if (!hasCollectionBinding(nodes, source.id, new Set(["timeline"]))) {
    issues.push({
      code: "liquidity_timeline_binding_required",
      message: "La interfaz debe mostrar el patrón diario enlazado al timeline derivado, con la visualización que mejor responda la pregunta",
    });
  }
  if (!hasCollectionBinding(nodes, source.id, new Set(["precedingExpenses"]))) {
    issues.push({
      code: "preceding_expenses_binding_required",
      message: "La interfaz debe mostrar los gastos previos usando el análisis derivado",
    });
  }
  const request = normalizeText(query.split("Nueva solicitud del usuario:").at(-1) ?? query);
  if (/\b(?:filtra(?:r|la)?|enfoca|deja)\b/u.test(request)
    && /\btabla\b/u.test(request)
    && /\bmovimientos?\b/u.test(request)) {
    const expected = readSourceRows(source.data, "transactions")
      .flatMap((row) => isRecord(row) && typeof row.id === "string" ? [row.id] : []);
    const completeTable = expected.length > 0 && nodes.some((node) => {
      if (node.type !== "table") return false;
      const resolved = resolveUiDataReference(node.data, dataSources);
      if (!Array.isArray(resolved)) return false;
      const visible = node.maxRows < 10 ? resolved.slice(0, node.maxRows) : resolved;
      const ids = visible.flatMap((row) => isRecord(row) && typeof row.id === "string" ? [row.id] : []);
      return ids.length === expected.length && expected.every((id) => ids.includes(id));
    });
    if (!completeTable) {
      issues.push({
        code: "liquidity_transactions_table_incomplete",
        message: "La tabla filtrada debe contener todos los movimientos observados del rango, no sólo los gastos previos al mínimo.",
      });
    }
  }
}

function hasCollectionBinding(nodes: UiNode[], sourceId: string, paths: ReadonlySet<string>) {
  return nodes.some((node) => (
    (node.type === "chart" || node.type === "heatmap" || node.type === "table")
    && node.data.sourceId === sourceId
    && node.data.path !== undefined
    && paths.has(node.data.path)
  ));
}

export function allowsProvisionalCollectionPreview(query: string): boolean {
  const requirements = extractExplicitUiRequirements(latestUiRequest(query));
  return !requirements.forbidTables
    && !requirements.forbidDashboard
    && !requirements.requireChart
    && !requirements.requireDateRange
    && !requirements.requireInteraction
    && !requirements.requireSlider
    && requirements.exactCharts === undefined
    && requirements.exactMetrics === undefined
    && requirements.maxCollectionItems === undefined;
}

function extractExplicitUiRequirements(query: string): ExplicitUiRequirements {
  const normalized = normalizeText(query);
  const forbidTables = explicitlyForbids(normalized, "tabla");
  const forbidCharts = explicitlyForbids(normalized, "grafica");
  const exactMetrics = extractExactCount(normalized, "metricas");
  const onlySingleFigure = /\b(?:solo|solamente) (?:dame|muestra(?:me)?) (?:una|1) cifra\b/u.test(normalized);
  const requestedChartCount = /\buna sola grafica\b/u.test(normalized)
    ? 1
    : extractExactCount(normalized, "graficas");
  const tableRequested = /\b(?:(?:como|en) (?:una )?tabla|una tabla|tabla de evolucion)\b/u.test(normalized);
  const explicitChart = /\b(?:una?|la|con|en|como) (?:grafica|grafico|chart)\b/u.test(normalized)
    || requestedChartCount !== undefined;
  const contributionControl = /\bcontrol para (?:cambiar|modificar|ajustar) (?:mi |la |una )?aportacion mensual\b/u.test(normalized);

  return {
    forbidTables: forbidTables || onlySingleFigure,
    forbidCharts: forbidCharts || onlySingleFigure,
    forbidDashboard: explicitlyForbids(normalized, "dashboard"),
    requireTable: !forbidTables && !onlySingleFigure && tableRequested,
    requireChart: !forbidCharts && !onlySingleFigure && explicitChart,
    requireDateRange: /\b(?:cambiar|modificar|elegir|ajustar) (?:el |las |un )?(?:periodo|fechas|rango)\b/u.test(normalized),
    requireInteraction: /\b(?:interactiv[ao]|interfaz para explorar)\b/u.test(normalized),
    requireSlider: /\b(?:slider|deslizador)\b/u.test(normalized) || contributionControl,
    requireNotesField: /\bcampo (?:de |para (?:mis |las )?)?(?:notas|comentarios|observaciones)\b/u.test(normalized),
    ...(forbidCharts || requestedChartCount === undefined ? {} : { exactCharts: requestedChartCount }),
    ...(exactMetrics === undefined && onlySingleFigure
      ? { exactMetrics: 1 }
      : exactMetrics === undefined ? {} : { exactMetrics }),
    ...extractTopCollectionLimit(normalized),
  };
}

function explicitlyForbids(query: string, noun: "tabla" | "grafica" | "dashboard") {
  const plural = noun === "dashboard" ? "dashboards?" : `${noun}s?`;
  return new RegExp(`\\bsin(?: usar)?(?: una| un)? ${plural}\\b`, "u").test(query)
    || new RegExp(`\\b(?:quita|elimina|retira|suprime)(?: (?:todas?|todos?|las?|los?|el|una?|unos?)){0,3} ${plural}\\b`, "u").test(query)
    || new RegExp(`\\bno (?:quiero|uses?|utilices?|incluyas?|muestres?|agregues?|necesito)(?: [a-z]+){0,4} ${plural}\\b`, "u").test(query);
}

function extractExactCount(query: string, noun: "graficas" | "metricas"): number | undefined {
  const singular = noun === "graficas" ? "grafica" : "metrica";
  const match = new RegExp(`\\b(?:exactamente|solo|solamente) (\\d+|una?|dos|tres|cuatro) ${singular}s?\\b`, "u").exec(query);
  return match?.[1] ? parseCount(match[1]) : undefined;
}

function extractTopCollectionLimit(query: string): Pick<ExplicitUiRequirements, "maxCollectionItems"> {
  const match = /\b(?:mis |las )?(\d+|una?|dos|tres|cuatro) categorias? (?:de gasto )?(?:mas altas|principales|mayores)\b/u.exec(query);
  const count = match?.[1] ? parseCount(match[1]) : undefined;
  return count === undefined ? {} : { maxCollectionItems: count };
}

function parseCount(value: string): number | undefined {
  const words: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
  const count = words[value] ?? Number(value);
  return Number.isInteger(count) && count > 0 && count <= 12 ? count : undefined;
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");
}

export function latestUiRequest(query: string): string {
  const marker = "Nueva solicitud del usuario:";
  const index = query.lastIndexOf(marker);
  return index < 0 ? query : query.slice(index + marker.length).trim();
}

function collectNodes(root: UiNode): UiNode[] {
  const children = root.type === "tabs"
    ? root.tabs.flatMap((tab) => tab.children)
    : "children" in root ? root.children : [];
  return [root, ...children.flatMap(collectNodes)];
}

function rejectNodes(
  nodes: UiNode[],
  type: UiNode["type"],
  code: string,
  message: string,
  issues: SemanticUiIssue[],
) {
  for (const node of nodes) {
    if (node.type === type) issues.push({ code, message, nodeId: node.id });
  }
}

function hasDateRange(nodes: UiNode[]) {
  return nodes.some((node) => node.type === "filters" && node.fields.some((field) => field.type === "date-range"));
}

function isInteractionNode(node: UiNode) {
  return node.type === "filters"
    || node.type === "form"
    || node.type === "button"
    || node.type === "slider"
    || node.type === "tabs";
}

function isDashboardLike(metricCount: number, chartCount: number, tableCount: number) {
  return metricCount >= 2
    || (chartCount > 0 && tableCount > 0)
    || metricCount + chartCount + tableCount >= 3;
}

function validateExactCount(
  type: "chart" | "metric",
  nodes: UiNode[],
  expected: number | undefined,
  code: string,
  issues: SemanticUiIssue[],
) {
  if (expected !== undefined && nodes.length !== expected) {
    issues.push({ code, message: `La solicitud requiere exactamente ${expected} ${type === "chart" ? "gráfica(s)" : "métrica(s)"}` });
  }
}

function hasVisibleChartValue(node: Extract<UiNode, { type: "chart" }>, rows: unknown[]) {
  return rows.some((row) => node.series.some((series) => {
    const value = readPath(row, series.key);
    return value !== null && value !== undefined && value !== "";
  }));
}

function hasVisibleHeatmapValue(node: Extract<UiNode, { type: "heatmap" }>, rows: unknown[]) {
  return rows.some((row) => {
    const value = readPath(row, node.valueKey);
    return value !== null && value !== undefined && value !== "";
  });
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
