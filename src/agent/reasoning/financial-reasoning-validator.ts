import { ComparePeriodsOutputSchema } from "../../schemas/compare-periods.schema.js";
import { type UiDataSource } from "../../ui/dsl/ui.schema.js";
import {
  LIQUIDITY_ANALYSIS_SOURCE,
  requiresLiquidityPrecursorAnalysis,
} from "./financial-intent-data-shaper.js";

export type FinancialReasoningIssueCode =
  | "anomaly-evidence-required"
  | "comparison-evidence-required"
  | "liquidity-window-evidence-required"
  | "projection-assumptions-required"
  | "partial-period-disclosure-required"
  | "silent-category-substitution";

export interface FinancialReasoningIssue {
  code: FinancialReasoningIssueCode;
  message: string;
}

export class FinancialReasoningError extends Error {
  constructor(readonly issues: readonly FinancialReasoningIssue[]) {
    super("El análisis financiero no superó la validación de consistencia");
    this.name = "FinancialReasoningError";
  }
}

interface FinancialReasoningInput {
  query: string;
  answer: string;
  toolsUsed: readonly string[];
  dataSources: readonly UiDataSource[];
}

const ANOMALY_INTENT = /\b(?:anomal(?:ía|ia|ías|ias)|inusual(?:es)?|atípico(?:s|a|as)?|atipico(?:s|a|as)?|fuera de lo normal|debería preocuparme|deberia preocuparme|preocupante)\b/iu;
const COMPARISON_INTENT = /\b(?:(?:compar(?:a|ar|ación|acion)).{0,80}(?:mes|periodo|categoría|categoria|gasto|ingreso|flujo)|mes (?:actual|en curso|este mes).{0,60}mes (?:anterior|pasado)|mes (?:anterior|pasado).{0,60}mes (?:actual|en curso|este mes)|rindió menos|rindio menos)\b/iu;
const PROJECTION_INTENT = /\b(?:simula|simular|simulación|simulacion|proyecta|proyección|proyeccion|si sigo|qué pasaría|que pasaria|voy a tener|alcanzar(?:é|e)?|meta de ahorro|ahorrar para)\b/iu;
const ASSUMPTION_DISCLOSURE = /\b(?:supuesto(?:s)?|asumiendo|si se mantiene|si mantienes|a este ritmo|estimación|estimacion|escenario|proyectad[oa]|no garantiza)\b/iu;
const PARTIAL_PERIOD_DISCLOSURE = /\b(?:parcial|corte|hasta el|al día|al dia|periodo en curso|mes en curso|del 1 al \d{1,2})\b/iu;
const CATEGORY_SUBSTITUTION = /\b(?:categoría|categoria).{0,80}(?:más afín|mas afin)|(?:tomando|usando|utilizando).{0,50}(?:como base|en lugar de).{0,50}(?:categoría|categoria)|(?:simulación|simulacion).{0,80}(?:otra categoría|otra categoria|categoría distinta|categoria distinta)\b/iu;

export function validateFinancialReasoning(
  input: FinancialReasoningInput,
): FinancialReasoningIssue[] {
  const issues: FinancialReasoningIssue[] = [];

  if (ANOMALY_INTENT.test(input.query) && !input.toolsUsed.includes("detect_transaction_anomalies")) {
    issues.push({
      code: "anomaly-evidence-required",
      message: "Una conclusión sobre anomalías o señales preocupantes requiere detect_transaction_anomalies.",
    });
  }

  if (COMPARISON_INTENT.test(input.query) && !hasComparisonEvidence(input.toolsUsed)) {
    issues.push({
      code: "comparison-evidence-required",
      message: "La comparación solicitada requiere compare_periods o una serie temporal de get_cashflow.",
    });
  }


  if (
    requiresLiquidityPrecursorAnalysis(input.query)
    && !input.dataSources.some((source) => source.toolName === LIQUIDITY_ANALYSIS_SOURCE)
  ) {
    issues.push({
      code: "liquidity-window-evidence-required",
      message: "El análisis de valles de liquidez requiere get_cashflow diario y get_transactions con el mismo startDate/endDate, limit 100 y paginación completa hasta hasMore=false.",
    });
  }

  if (PROJECTION_INTENT.test(input.query) && !ASSUMPTION_DISCLOSURE.test(input.answer)) {
    issues.push({
      code: "projection-assumptions-required",
      message: "Toda proyección o simulación debe declarar de forma visible sus supuestos y naturaleza estimada.",
    });
  }

  if (hasUnequalComparisonPeriods(input.dataSources) && !PARTIAL_PERIOD_DISCLOSURE.test(input.answer)) {
    issues.push({
      code: "partial-period-disclosure-required",
      message: "La respuesta compara periodos de distinta duración sin advertir que el corte es parcial.",
    });
  }

  if (CATEGORY_SUBSTITUTION.test(input.answer)) {
    issues.push({
      code: "silent-category-substitution",
      message: "No se permite sustituir una categoría solicitada por otra para completar un cálculo.",
    });
  }

  return issues;
}

export function createFinancialReasoningRepairPrompt(
  issues: readonly FinancialReasoningIssue[],
): string {
  return [
    "Tu respuesta anterior no puede entregarse porque incumple reglas de razonamiento financiero.",
    ...issues.map((issue) => `- ${issue.message}`),
    "Corrige la respuesta usando las herramientas disponibles cuando falte evidencia.",
    "No sustituyas categorías ni ocultes supuestos. Si los datos no permiten responder, dilo de forma explícita y no inventes un resultado.",
  ].join("\n");
}

function hasComparisonEvidence(toolsUsed: readonly string[]): boolean {
  return toolsUsed.includes("compare_periods") || toolsUsed.includes("get_cashflow");
}

function hasUnequalComparisonPeriods(dataSources: readonly UiDataSource[]): boolean {
  return dataSources.some((source) => {
    if (source.toolName !== "compare_periods") return false;
    const result = ComparePeriodsOutputSchema.safeParse(source.data);
    if (!result.success) return false;
    const { previousPeriod, currentPeriod } = result.data.metadata;
    return inclusiveDays(previousPeriod.startDate, previousPeriod.endDate)
      !== inclusiveDays(currentPeriod.startDate, currentPeriod.endDate);
  });
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}
