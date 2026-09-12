import { type UiDataSource } from "../dsl/ui.schema.js";
import { type SemanticUiIssue } from "./semantic-ui-validator.js";

interface UiRecoveryPlanInput {
  issues: readonly SemanticUiIssue[];
  dataSources: readonly UiDataSource[];
  attempt: number;
}

const MAX_BINDING_CANDIDATES = 24;

export function createUiRecoveryPlan(input: UiRecoveryPlanInput): string {
  const issueCodes = new Set(input.issues.map((issue) => issue.code));
  const actions = input.issues.flatMap(recoveryActionForIssue);
  const bindingCatalog = createBindingCatalog(input.dataSources);

  if (issueCodes.has("dashboard_composition_forbidden") || issueCodes.has("dashboard_forbidden")) {
    actions.push(
      "Usa stack o tabs como raíz y conserva una sola superficie analítica visible a la vez; si la intención exige gráfica y detalle, sepáralos en pestañas.",
    );
  }
  if (input.attempt >= 3) {
    actions.push(
      "Esta es la última recuperación: reduce la composición al mínimo que todavía cumpla todas las restricciones explícitas.",
    );
  }

  return [
    "Plan de recuperación obligatorio:",
    ...unique(actions).map((action) => `- ${action}`),
    bindingCatalog.length > 0
      ? `Bindings comprobados disponibles:\n${bindingCatalog.map((candidate) => `- ${candidate}`).join("\n")}`
      : "No existen bindings comprobados; usa únicamente nodos de texto o alerta y explica la ausencia de datos.",
    "No copies valores dentro del documento y no uses rutas distintas de los bindings comprobados.",
  ].join("\n");
}

function recoveryActionForIssue(issue: SemanticUiIssue): string[] {
  switch (issue.code) {
    case "payment_capture_required":
      return ["Genera form editable con select de cuenta origen y beneficiario, campo monto, campo moneda y concepto, submitLabel 'Revisar pago'. Opciones basadas en get_accounts/get_beneficiaries; no confirmes ni inventes saldo estimado."];
    case "payment_option_unverified":
    case "payment_prefill_unverified":
      return [issue.message];
    case "payment_review_incomplete":
      return ["Muestra un resumen de intención pendiente con cuenta origen y beneficiario verificados, monto, concepto, comisión, saldo estimado, vencimiento y un solo botón Confirmar pago; no regreses al formulario."];
    case "payment_receipt_required":
      return ["Muestra un comprobante definitivo enlazado a confirm_payment con número de recibo, monto, comisión, saldo posterior y estado; elimina controles de captura y confirmación."];
    case "education_guidance_required":
      return ["Incluye texto o alertas con la explicación y recomendaciones de answer, identificadas como RECOMMENDED. Respeta categorías intocables y vincula cifras observadas a datos; no inventes excedentes. Si faltan datos, explica esa limitación."];
    case "dashboard_forbidden":
      return ["Elimina todos los nodos dashboard."];
    case "dashboard_composition_forbidden":
      return ["Reduce la densidad y evita una composición de resumen ejecutivo."];
    case "table_forbidden":
      return ["Elimina todas las tablas y conserva la información mediante otra primitiva permitida."];
    case "chart_forbidden":
      return ["Elimina todas las gráficas."];
    case "table_required":
      return ["Incluye exactamente la tabla necesaria, vinculada a una colección no vacía."];
    case "chart_required":
      return ["Incluye una gráfica vinculada a una colección no vacía y a series numéricas comprobadas."];
    case "date_range_required":
      return ["Incluye filters con un campo date-range para que el usuario pueda cambiar el periodo."];
    case "slider_required":
      return ["Incluye un slider con límites, paso y valor inicial explícitos derivados de la solicitud."];
    case "notes_field_required":
      return ["Incluye un form con un campo type text etiquetado como notas y con maxLength; conserva su id cuando la actualización no modifica ese campo."];
    case "interaction_required":
      return ["Incluye un control útil para explorar el resultado, como filters, tabs o slider; no agregues un botón decorativo."];
    case "chart_count_mismatch":
    case "metric_count_mismatch":
      return [issue.message];
    case "collection_limit_exceeded":
      return [
        `${issue.message}. Si el DSL no puede recortar la colección para una gráfica, usa una tabla con maxRows igual al límite solicitado.`,
      ];
    case "empty_collection":
      return ["Reemplaza el binding vacío por una colección no vacía del catálogo."];
    case "empty_chart":
      return ["Usa como series únicamente claves numéricas comprobadas del catálogo."];
    case "empty_metric":
      return ["Vincula la métrica a un valor escalar comprobado del catálogo."];
    case "payment_confirmation_required":
      return ["Incluye un único button con action.type confirm-payment para el intent pendiente."];
    case "payment_confirmation_forbidden":
      return ["Elimina todo button confirm-payment porque no existe un intent pendiente."];
    default:
      return [issue.message];
  }
}

function createBindingCatalog(dataSources: readonly UiDataSource[]): string[] {
  const candidates: string[] = [];
  for (const source of dataSources) {
    collectBindingCandidates(source.data, source.id, "", candidates);
    if (candidates.length >= MAX_BINDING_CANDIDATES) break;
  }
  return candidates.slice(0, MAX_BINDING_CANDIDATES);
}

function collectBindingCandidates(
  value: unknown,
  sourceId: string,
  path: string,
  candidates: string[],
): void {
  if (candidates.length >= MAX_BINDING_CANDIDATES || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    if (path && value.length > 0) {
      const firstRow = value[0];
      const keys = isRecord(firstRow) ? Object.keys(firstRow).slice(0, 12) : [];
      const numericKeys = keys.filter((key) => isNumericValue(firstRow[key]));
      candidates.push(
        `${sourceId}.${path} colección(${value.length}); claves=[${keys.join(", ")}]; numéricas=[${numericKeys.join(", ")}]`,
      );
      collectBindingCandidates(firstRow, sourceId, `${path}.0`, candidates);
    }
    return;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "userId") continue;
      collectBindingCandidates(nestedValue, sourceId, path ? `${path}.${key}` : key, candidates);
      if (candidates.length >= MAX_BINDING_CANDIDATES) return;
    }
    return;
  }

  if (path && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
    candidates.push(`${sourceId}.${path} escalar(${typeof value})`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericValue(value: unknown): boolean {
  return typeof value === "number"
    || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
