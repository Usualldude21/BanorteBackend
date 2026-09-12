import { z } from "zod";
import { type UiDocument, type UiNode } from "../dsl/ui.schema.js";

const MAX_EVENT_VALUE_LENGTH = 500;
const MAX_EVENT_VALUES = 24;
const MAX_EVENT_DATA_LENGTH = 600;
const UiIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const InputKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}(?:\.(?:start|end))?$/);
const InputValuesSchema = z.record(InputKeySchema, z.string().max(MAX_EVENT_VALUE_LENGTH))
  .superRefine(validateInputSize);

export const UiInteractionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("refresh"),
    sourceId: UiIdSchema,
  }).strict(),
  z.object({
    type: z.literal("apply-filters"),
    sourceId: UiIdSchema,
    values: InputValuesSchema,
  }).strict(),
  z.object({
    type: z.literal("submit-form"),
    sourceId: UiIdSchema,
    values: InputValuesSchema,
  }).strict(),
  z.object({
    type: z.literal("select-tab"),
    sourceId: UiIdSchema,
    tabId: UiIdSchema,
  }).strict(),
  z.object({
    type: z.literal("change-slider"),
    sourceId: UiIdSchema,
    value: z.number().finite(),
  }).strict(),
]);

export type UiInteractionEvent = z.infer<typeof UiInteractionEventSchema>;

export function parseUiInteractionEvent(
  input: unknown,
  document: UiDocument,
): UiInteractionEvent {
  const event = UiInteractionEventSchema.parse(input);
  const source = findNode(document.root, event.sourceId);
  if (!source) throw new UiInteractionValidationError("El control de origen no existe");

  switch (event.type) {
    case "refresh":
      validateRefreshSource(source);
      break;
    case "apply-filters":
      if (source.type !== "filters") {
        throw new UiInteractionValidationError("El evento no pertenece a un filtro");
      }
      validateFilterValues(source, event.values);
      break;
    case "submit-form":
      if (source.type !== "form") {
        throw new UiInteractionValidationError("El evento no pertenece a un formulario");
      }
      validateFormValues(source, event.values);
      break;
    case "select-tab":
      if (source.type !== "tabs" || !source.tabs.some((tab) => tab.id === event.tabId)) {
        throw new UiInteractionValidationError("La pestaña seleccionada no existe");
      }
      break;
    case "change-slider":
      if (source.type !== "slider" || event.value < source.min || event.value > source.max) {
        throw new UiInteractionValidationError("El valor del slider no es válido");
      }
      break;
    default:
      assertNever(event);
  }

  return event;
}

function validateInputSize(values: Record<string, string>, context: z.RefinementCtx): void {
  const entries = Object.entries(values);
  if (entries.length > MAX_EVENT_VALUES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "El evento contiene demasiados valores" });
  }
  const totalLength = entries.reduce(
    (length, [key, value]) => length + key.length + value.length,
    0,
  );
  if (totalLength > MAX_EVENT_DATA_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "El evento supera el tamaño permitido" });
  }
}

function validateRefreshSource(node: UiNode): void {
  if (node.type !== "button" || node.action.type !== "refresh") {
    throw new UiInteractionValidationError("El evento no pertenece a una acción de actualización");
  }
}

function validateFormValues(
  node: Extract<UiNode, { type: "form" }>,
  values: Record<string, string>,
): void {
  const allowedKeys = new Set(node.fields.map((field) => field.id));
  validateExactKeys(values, allowedKeys);

  for (const field of node.fields) {
    const value = values[field.id] ?? "";
    if (field.type === "text" && value.length > (field.maxLength ?? MAX_EVENT_VALUE_LENGTH)) {
      throw new UiInteractionValidationError("Un valor excede la longitud permitida");
    }
    if (field.type === "date" && value !== "" && !isValidIsoDate(value)) {
      throw new UiInteractionValidationError("El formulario contiene una fecha inválida");
    }
    if (field.type === "select" && !field.options.some((option) => option.value === value)) {
      throw new UiInteractionValidationError("El formulario contiene una opción inválida");
    }
  }
}

function validateFilterValues(
  node: Extract<UiNode, { type: "filters" }>,
  values: Record<string, string>,
): void {
  const allowedKeys = new Set(node.fields.flatMap((field) => (
    field.type === "date-range" ? [`${field.id}.start`, `${field.id}.end`] : [field.id]
  )));
  validateExactKeys(values, allowedKeys);

  for (const field of node.fields) {
    if (field.type === "select") {
      const value = values[field.id] ?? "";
      if (!field.options.some((option) => option.value === value)) {
        throw new UiInteractionValidationError("El filtro contiene una opción inválida");
      }
      continue;
    }
    const start = values[`${field.id}.start`] ?? "";
    const end = values[`${field.id}.end`] ?? "";
    if ((start !== "" && !isValidIsoDate(start)) || (end !== "" && !isValidIsoDate(end))) {
      throw new UiInteractionValidationError("El filtro contiene una fecha inválida");
    }
    if (start !== "" && end !== "" && start > end) {
      throw new UiInteractionValidationError("El inicio del periodo es posterior al final");
    }
  }
}

function validateExactKeys(values: Record<string, string>, allowedKeys: Set<string>): void {
  const receivedKeys = Object.keys(values);
  if (
    receivedKeys.length !== allowedKeys.size
    || receivedKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new UiInteractionValidationError("El evento contiene campos inesperados o incompletos");
  }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function findNode(node: UiNode, id: string): UiNode | undefined {
  if (node.id === id) return node;
  const children = node.type === "tabs"
    ? node.tabs.flatMap((tab) => tab.children)
    : "children" in node ? node.children : [];
  for (const child of children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return undefined;
}

function assertNever(value: never): never {
  throw new Error(`Evento de UI no soportado: ${String(value)}`);
}

export class UiInteractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiInteractionValidationError";
  }
}
