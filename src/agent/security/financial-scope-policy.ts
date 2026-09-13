import { type UiDocument } from "../../ui/dsl/ui.schema.js";

export type FinancialExperienceScope = "personal_banking" | "full";
export type FinancialScopeBlockReason = "prompt-injection" | "out-of-scope" | "product-scope";

export type FinancialScopeDecision =
  | { allowed: true; category: "financial" | "ui-transform" | "greeting" | "capabilities" }
  | { allowed: false; reason: FinancialScopeBlockReason };

const FINANCIAL_INTENT = /\b(?:finanz(?:a|as|iero|iera)|banc(?:o|a|ario|aria)|cuenta(?:s)?|saldo(?:s)?|dinero|transacci(?:on|ones)|movimiento(?:s)?|compra(?:s)?|cargos?|comercios?|gast(?:o(?:s)?|e|ar|ando)|ingreso(?:s)?|ahorr[a-z]*|presupuesto|pago(?:s)?|pagar|transfer(?:ir|encia|encias)?|beneficiario(?:s)?|nomina|efectivo|flujo\s+de\s+efectivo|liquidez|prestamo(?:s)?|credito(?:s)?|deuda(?:s)?|interes(?:es)?|tasa(?:s)?|moneda(?:s)?|mxn|usd|eur|peso(?:s)?|dolar(?:es)?|categoria(?:s)?|deposito(?:s)?|retiro(?:s)?|tarjeta(?:s)?|fraude|anomalia(?:s)?|inversion(?:es)?|rendimiento(?:s)?|cash\s*flow|account(?:s)?|balance(?:s)?|transaction(?:s)?|expense(?:s)?|income|saving(?:s)?|budget|payment(?:s)?|loan(?:s)?|debt(?:s)?|interest|beneficiar(?:y|ies))\b/u;
const FINANCIAL_PHRASE = /\b(?:cuanto\s+(?:dinero\s+)?tengo|dinero\s+disponible|salud\s+financiera|resumen\s+financiero|mes\s+(?:actual|pasado|anterior)|periodo\s+(?:actual|anterior)|compar(?:a|ar|acion)\b.{0,80}\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|mes|periodo)|restaurante(?:s)?\b.{0,80}\b(?:gaste|gasto|reducir|nivel|mes|periodo))\b/u;
const PERSONAL_BANKING_FOLLOW_UP = /\b(?:ahora\s+(?:muestra|muestrame)|(?:solo|solamente)\s+(?:restaurantes|entretenimiento|vivienda|transporte)|cuanto\s+cambi[oó]\s+respecto(?:\s+a)?|(?:ese|esa)\s+(?:cambio|variaci[oó]n))\b/u;
const UI_TRANSFORM_ACTION = /\b(?:quit(?:a|ar)|elimin(?:a|ar)|ocult(?:a|ar)|suprim(?:e|ir)|retir(?:a|ar)|dej(?:a|ar|ame)|conserv(?:a|ar)|convert(?:ir|irlo|irla|irlos|irlas)|conviert(?:e|elo|ela|elos|elas)|transform(?:a|ar)|reorganiz(?:a|ar)|orden(?:a|ar)|agrup(?:a|ar)|muev(?:e|elo|ela)|mov(?:er|erlo|erla)|pon|ponlo|ponla|coloc(?:a|ar)|sub(?:e|ir)|prioriz(?:a|ar)|cambi(?:a|ar)|ajust(?:a|ar)|actualiz(?:a|ar)|edit(?:a|ar)|filtr(?:a|ar)|muestr(?:a|ame|ar)|ensen(?:a|ame|ar)|ampli(?:a|ar)|reduc(?:e|ir)|simplific(?:a|ar))\b/u;
const UI_PRESENTATION_REFERENCE = /\b(?:grafic[a-z]*|tabl[a-z]*|tabal[a-z]*|vist[a-z]*|visualiz[a-z]*|timeline|linea\s+temporal|tarjet[a-z]*|metric[a-z]*|filtro(?:s)?|control(?:es)?|bloque(?:s)?|seccion(?:es)?|interfaz|ui|evidencia|resultado|comparacion(?:es)?|cambio(?:s)?|variacion(?:es)?|estos?\s+datos|mis\s+datos|lo\s+mismo|lo\s+anterior)\b/u;
const UI_REPLAY_FOLLOW_UP = /\b(?:muestr(?:a|ame)|ensen(?:a|ame))\b.{0,45}\b(?:lo\s+mismo|lo\s+anterior|mis\s+datos|estos?\s+datos|de\s+nuevo|otra\s+vez)\b|\b(?:de\s+nuevo|otra\s+vez)\b.{0,45}\b(?:muestr(?:a|ame)|ensen(?:a|ame))\b/u;
const FULL_EXPERIENCE_FOLLOW_UP = /\b(?:aport(?:ar|e|o|as|amos)|plazo)\b/u;
const TEMPORAL_FINANCIAL_REQUEST = /\b(?:gast(?:e|é|o|os)|gasto(?:s)?|cargos?|movimiento(?:s)?|transacci(?:on|ones)|compar(?:a|ar|acion)|categor[ií]a(?:s)?)\b/u;
const EXPLICIT_PERIOD = /\b(?:hoy|ayer|semana(?:s)?|mes(?:es)?|trimestre(?:s)?|a[nñ]o(?:s)?|periodo(?:s)?|fecha(?:s)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|reciente(?:s)?|ultimo(?:s)?|[0-9]{4}-[0-9]{2}-[0-9]{2})\b/u;
const GREETING = /^(?:hola|buen(?:os|as)?\s+(?:dias|tardes|noches)|hey|hello|hi|gracias|muchas\s+gracias|adios|hasta\s+luego)[!,.?\s]*$/u;
const CAPABILITIES = /\b(?:que\s+(?:puedes|sabes)\s+hacer|como\s+(?:puedes\s+)?ayudarme|en\s+que\s+(?:puedes\s+)?ayudarme|tus\s+capacidades|quien\s+eres|ayuda\s+financiera|what\s+can\s+you\s+do|how\s+can\s+you\s+help)\b/u;
const OUTSIDE_PERSONAL_BANKING = /\b(?:pago(?:s)?|pagar|beneficiario(?:s)?|prestamo(?:s)?|credito(?:s)?|deuda(?:s)?|salud\s+financiera|educacion\s+financiera|simul(?:a|ar|acion)|meta\s+de\s+ahorro)\b/u;
const TRANSFER_REFERENCE = /\b(?:transferencias?|transferir|transfiere|transfiereme)\b/u;
const TRANSFER_READ_ONLY = /\b(?:muestra(?:me)?|consulta(?:r)?|analiza(?:r)?|explica(?:r)?|compara(?:r)?|revisa(?:r)?|historicas?|pasadas?|realizadas?|mis\s+transferencias|entre\s+mis\s+cuentas|contarlas\s+dos\s+veces)\b/u;
const TRANSFER_ACTION = /\b(?:transferir|transfiere|transfiereme|prepara(?:r)?|programa(?:r)?|ejecuta(?:r)?|confirma(?:r)?|envia(?:r)?|manda(?:r)?|haz|hacer|realiza(?:r)?)\b.{0,100}\btransferencias?\b|\btransferencias?\b.{0,100}\b(?:ahora|nueva|nuevo|prepara(?:r)?|programa(?:r)?|ejecuta(?:r)?|confirma(?:r)?)\b/u;
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

export function classifyFinancialQuery(
  query: string,
  experienceScope: FinancialExperienceScope = "full",
): FinancialScopeDecision {
  const normalized = normalize(query);
  const request = latestUserRequest(normalized);
  if (PROMPT_INJECTION.some((pattern) => pattern.test(request))) {
    return { allowed: false, reason: "prompt-injection" };
  }
  if (experienceScope === "personal_banking" && (OUTSIDE_PERSONAL_BANKING.test(request)
    || (TRANSFER_REFERENCE.test(request) && (!TRANSFER_READ_ONLY.test(request) || TRANSFER_ACTION.test(request))))) {
    return { allowed: false, reason: "product-scope" };
  }
  if (OUT_OF_SCOPE_CONTENT.test(request) && !FINANCIAL_INTENT.test(request)) {
    return { allowed: false, reason: "out-of-scope" };
  }
  const hasFinancialSessionContext = hasPriorFinancialSessionContext(normalized);
  if (hasFinancialSessionContext && isUiTransformRequest(request)) {
    return { allowed: true, category: "ui-transform" };
  }
  if (
    FINANCIAL_INTENT.test(request)
    || FINANCIAL_PHRASE.test(request)
    || PERSONAL_BANKING_FOLLOW_UP.test(request)
    || (experienceScope === "full" && FULL_EXPERIENCE_FOLLOW_UP.test(request))
  ) {
    return { allowed: true, category: "financial" };
  }
  if (GREETING.test(request)) return { allowed: true, category: "greeting" };
  if (CAPABILITIES.test(request)) return { allowed: true, category: "capabilities" };
  return { allowed: false, reason: "out-of-scope" };
}

export function createMissingPeriodResponse(query: string): { answer: string; ui: UiDocument } | undefined {
  const normalized = normalize(query);
  if (normalized.includes("nueva solicitud del usuario:" )) return undefined;
  if (!TEMPORAL_FINANCIAL_REQUEST.test(normalized) || EXPLICIT_PERIOD.test(normalized)) return undefined;

  const answer = normalized.includes("compar")
    ? "Para comparar tus gastos necesito los dos periodos que deseas revisar, por ejemplo: julio y agosto de 2026."
    : normalized.includes("movimiento") || normalized.includes("transacci")
    ? "Para mostrar tus movimientos necesito un periodo, por ejemplo: agosto de 2026 o tus últimos 30 días."
    : "Para indicarte ese gasto necesito el periodo que deseas consultar, por ejemplo: este mes, el mes pasado o un rango de fechas.";

  return {
    answer,
    ui: {
      version: "1.0",
      root: {
        id: "financial-period-request",
        type: "alert",
        severity: "info",
        text: answer,
      },
    },
  };
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
  experienceScope: FinancialExperienceScope = "full",
): { answer: string; ui: UiDocument } {
  const answer = reason === "prompt-injection"
    ? "No puedo seguir instrucciones que intenten cambiar mis reglas, identidad o controles de seguridad. Puedo ayudarte con una consulta legítima de banca personal."
    : reason === "product-scope"
    ? "Esta experiencia se concentra en banca personal. Puedo ayudarte a consultar cuentas y movimientos, comparar periodos, entender cambios en tus gastos y revisar movimientos atípicos. Prueba con: «Compara mis gastos de julio y agosto» o «Muéstrame mis últimos movimientos»."
    : reason === "unsafe-response"
    ? "No fue posible producir una respuesta bancaria segura. Reformula tu consulta usando únicamente información de banca o finanzas personales."
    : experienceScope === "personal_banking"
    ? "Esta experiencia se concentra en banca personal. Puedo ayudarte con cuentas, saldos, movimientos, ingresos, gastos, comparaciones y movimientos atípicos. Prueba con: «Compara mis gastos de julio y agosto»."
    : "Solo puedo ayudar con banca y finanzas personales, como cuentas, saldos, transacciones, ingresos, gastos, ahorro y pagos.";
  return {
    answer,
    ui: {
      version: "1.0",
      root: {
        id: "financial-scope-notice",
        type: "alert",
        severity: reason === "out-of-scope" || reason === "product-scope" ? "info" : "warning",
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

function latestUserRequest(normalizedQuery: string): string {
  return normalizedQuery.split("nueva solicitud del usuario:").at(-1)?.trim() || normalizedQuery;
}

function hasPriorFinancialSessionContext(normalizedQuery: string): boolean {
  const marker = "nueva solicitud del usuario:";
  const markerIndex = normalizedQuery.lastIndexOf(marker);
  if (markerIndex < 0) return false;
  return FINANCIAL_INTENT.test(normalizedQuery.slice(0, markerIndex));
}

function isUiTransformRequest(request: string): boolean {
  return UI_REPLAY_FOLLOW_UP.test(request)
    || (UI_TRANSFORM_ACTION.test(request) && UI_PRESENTATION_REFERENCE.test(request));
}
