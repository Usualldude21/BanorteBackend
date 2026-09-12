import { type UiDocument } from "../../ui/dsl/ui.schema.js";

export type FinancialScopeBlockReason = "prompt-injection" | "out-of-scope";

export type FinancialScopeDecision =
  | { allowed: true; category: "financial" | "greeting" | "capabilities" }
  | { allowed: false; reason: FinancialScopeBlockReason };

const FINANCIAL_INTENT = /\b(?:finanz(?:a|as|iero|iera)|banc(?:o|a|ario|aria)|cuenta(?:s)?|saldo(?:s)?|dinero|transacci(?:on|ones)|movimiento(?:s)?|gast(?:o(?:s)?|e)|ingreso(?:s)?|ahorr(?:o(?:s)?|ar)|presupuesto|pago(?:s)?|pagar|transfer(?:ir|encia|encias)?|beneficiario(?:s)?|nomina|efectivo|flujo\s+de\s+efectivo|liquidez|prestamo(?:s)?|credito(?:s)?|deuda(?:s)?|interes(?:es)?|tasa(?:s)?|moneda(?:s)?|mxn|usd|eur|peso(?:s)?|dolar(?:es)?|categoria(?:s)?|deposito(?:s)?|retiro(?:s)?|tarjeta(?:s)?|fraude|anomalia(?:s)?|inversion(?:es)?|rendimiento(?:s)?|cash\s*flow|account(?:s)?|balance(?:s)?|transaction(?:s)?|expense(?:s)?|income|saving(?:s)?|budget|payment(?:s)?|loan(?:s)?|debt(?:s)?|interest|beneficiar(?:y|ies))\b/u;
const FINANCIAL_PHRASE = /\b(?:cuanto\s+(?:dinero\s+)?tengo|dinero\s+disponible|salud\s+financiera|resumen\s+financiero|mes\s+(?:actual|pasado|anterior)|periodo\s+(?:actual|anterior))\b/u;
const GREETING = /^(?:hola|buen(?:os|as)?\s+(?:dias|tardes|noches)|hey|hello|hi|gracias|muchas\s+gracias|adios|hasta\s+luego)[!,.?\s]*$/u;
const CAPABILITIES = /\b(?:que\s+(?:puedes|sabes)\s+hacer|como\s+(?:puedes\s+)?ayudarme|en\s+que\s+(?:puedes\s+)?ayudarme|tus\s+capacidades|quien\s+eres|ayuda\s+financiera|what\s+can\s+you\s+do|how\s+can\s+you\s+help)\b/u;
const SAFE_CONVERSATION = /\b(?:hola|gracias|con\s+gusto|puedo\s+ayudarte|como\s+puedo\s+ayudarte|hasta\s+luego)\b/u;
const FINANCIAL_VALUE = /(?:[$€£]\s*\d|\b\d[\d,.]*\s*(?:mxn|usd|eur|pesos?|dolares?)\b)/u;
const PROMPT_INJECTION = [
  /\b(?:ignora|omite|olvida|desobedece|anula)\b.{0,80}\b(?:instrucciones|reglas|prompt|mensaje\s+de\s+sistema|politicas)\b/u,
  /\b(?:ignore|forget|override|disregard)\b.{0,80}\b(?:instructions|rules|prompt|system\s+message|policies)\b/u,
  /\b(?:muestra|revela|imprime|expone|dime)\b.{0,80}\b(?:prompt|instrucciones\s+internas|mensaje\s+de\s+sistema|secreto(?:s)?)\b/u,
  /\b(?:show|reveal|print|expose)\b.{0,80}\b(?:system\s+prompt|internal\s+instructions|secret(?:s)?)\b/u,
  /\b(?:jailbreak|modo\s+dan|developer\s+mode|system\s+override)\b/u,
  /\b(?:usa|usar|cambia|cambiar|sustituye|suplanta)\b.{0,50}\buser[\s_-]*id\b/u,
  /\b(?:confirma|confirmar|ejecuta|ejecutar)\b.{0,80}\b(?:sin\s+(?:mostrar(?:me|melo)?|ensenar(?:me|melo)?|confirmacion)|sin\s+que\s+preguntes)\b/u,
  /\b(?:nunca|no)\s+(?:pidas|preguntes|solicites)\b.{0,50}\bconfirmacion\b/u,
  /\b(?:elude|evita|salta|desactiva|bypass)\b.{0,60}\b(?:seguridad|confirmacion|autorizacion|politica|policy)\b/u,
];
const PROMPT_DISCLOSURE = /\b(?:system\s+prompt|developer\s+message|mensaje\s+de\s+sistema|instrucciones\s+internas)\b/u;
const OUT_OF_SCOPE_CONTENT = /\b(?:capital\s+de\s+[a-z]+|receta(?:s)?|clima|pronostico\s+del\s+tiempo|futbol|partido\s+deportivo|presidente\s+de|javascript|python|programacion|pelicula(?:s)?|serie(?:s)?\s+de\s+television)\b/u;

export function classifyFinancialQuery(query: string): FinancialScopeDecision {
  const normalized = normalize(query);
  if (PROMPT_INJECTION.some((pattern) => pattern.test(normalized))) {
    return { allowed: false, reason: "prompt-injection" };
  }
  if (FINANCIAL_INTENT.test(normalized) || FINANCIAL_PHRASE.test(normalized)) {
    return { allowed: true, category: "financial" };
  }
  if (GREETING.test(normalized)) return { allowed: true, category: "greeting" };
  if (CAPABILITIES.test(normalized)) return { allowed: true, category: "capabilities" };
  return { allowed: false, reason: "out-of-scope" };
}

export function isFinancialResponseSafe(answer: string): boolean {
  const normalized = normalize(answer);
  if (PROMPT_DISCLOSURE.test(normalized)) return false;
  if (PROMPT_INJECTION.some((pattern) => pattern.test(normalized))) return false;
  if (OUT_OF_SCOPE_CONTENT.test(normalized) && !FINANCIAL_INTENT.test(normalized)) return false;
  return FINANCIAL_INTENT.test(normalized)
    || FINANCIAL_PHRASE.test(normalized)
    || FINANCIAL_VALUE.test(normalized)
    || GREETING.test(normalized)
    || CAPABILITIES.test(normalized)
    || SAFE_CONVERSATION.test(normalized);
}

export function createFinancialScopeResponse(
  reason: FinancialScopeBlockReason | "unsafe-response",
): { answer: string; ui: UiDocument } {
  const answer = reason === "prompt-injection"
    ? "No puedo seguir instrucciones que intenten cambiar mis reglas, identidad o controles de seguridad. Puedo ayudarte con una consulta legítima de banca personal."
    : reason === "unsafe-response"
    ? "No fue posible producir una respuesta bancaria segura. Reformula tu consulta usando únicamente información de banca o finanzas personales."
    : "Solo puedo ayudar con banca y finanzas personales, como cuentas, saldos, transacciones, ingresos, gastos, ahorro y pagos.";
  return {
    answer,
    ui: {
      version: "1.0",
      root: {
        id: "financial-scope-notice",
        type: "alert",
        severity: reason === "out-of-scope" ? "info" : "warning",
        text: answer,
      },
    },
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}
