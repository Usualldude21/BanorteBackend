import { z } from "zod";

export const UI_DSL_VERSION = "1.0" as const;
export const MAX_UI_DEPTH = 8;
export const MAX_UI_NODES = 100;
export const MAX_UI_DATA_SOURCES = 20;

const MAX_CHILDREN = 24;
const MAX_UI_JSON_DEPTH = 24;
const MAX_UI_JSON_VALUES = 5_000;
const MAX_TEXT_LENGTH = 2_000;
const UiIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const DataKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
  .refine((value) => !value.split(".").some(isForbiddenDataKey));

export const UiDataSourceSchema = z.object({
  id: UiIdSchema,
  toolName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  data: z.unknown(),
}).strict();

export const UiDataSourcesSchema = z.array(UiDataSourceSchema)
  .max(MAX_UI_DATA_SOURCES)
  .superRefine((sources, context) => {
    const ids = sources.map((source) => source.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las fuentes de UI contienen identificadores duplicados",
      });
    }
  });

export const UiDataReferenceSchema = z.object({
  sourceId: UiIdSchema,
  path: DataKeySchema.optional(),
}).strict();

const SelectOptionSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().min(1).max(100),
}).strict();

const TextFieldSchema = z.object({
  id: UiIdSchema,
  type: z.literal("text"),
  label: z.string().trim().min(1).max(100),
  placeholder: z.string().trim().max(160).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
  initialValue: z.string().max(500).optional(),
}).strict();

const DateFieldSchema = z.object({
  id: UiIdSchema,
  type: z.literal("date"),
  label: z.string().trim().min(1).max(100),
}).strict();

const SelectFieldSchema = z.object({
  id: UiIdSchema,
  type: z.literal("select"),
  label: z.string().trim().min(1).max(100),
  options: z.array(SelectOptionSchema).min(1).max(30),
  initialValue: z.string().max(100).optional(),
}).strict();

const FormFieldSchema = z.discriminatedUnion("type", [
  TextFieldSchema,
  DateFieldSchema,
  SelectFieldSchema,
]);

const DateRangeFilterSchema = z.object({
  id: UiIdSchema,
  type: z.literal("date-range"),
  label: z.string().trim().min(1).max(100),
  initialValue: z.object({
    start: z.string().date(),
    end: z.string().date(),
  }).strict().optional(),
}).strict();

const SelectFilterSchema = z.object({
  id: UiIdSchema,
  type: z.literal("select"),
  label: z.string().trim().min(1).max(100),
  options: z.array(SelectOptionSchema).min(1).max(30),
}).strict();

const FilterFieldSchema = z.discriminatedUnion("type", [
  DateRangeFilterSchema,
  SelectFilterSchema,
]);

const ButtonActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("refresh") }).strict(),
  z.object({ type: z.literal("confirm-payment") }).strict(),
  z.object({ type: z.literal("apply-filters"), filterId: UiIdSchema }).strict(),
  z.object({ type: z.literal("submit-form"), formId: UiIdSchema }).strict(),
  z.object({
    type: z.literal("select-tab"),
    tabsId: UiIdSchema,
    tabId: UiIdSchema,
  }).strict(),
]);

interface DashboardNode {
  id: string;
  type: "dashboard";
  title: string;
  children: UiNode[];
}

interface StackNode {
  id: string;
  type: "stack";
  direction: "horizontal" | "vertical";
  children: UiNode[];
}

interface GridNode {
  id: string;
  type: "grid";
  columnCount: number;
  children: UiNode[];
}

interface CardNode {
  id: string;
  type: "card";
  title?: string | undefined;
  children: UiNode[];
}

interface TextNode {
  id: string;
  type: "text";
  text: string;
  variant: "title" | "subtitle" | "body" | "caption";
}

interface MetricNode {
  id: string;
  type: "metric";
  label: string;
  value: z.infer<typeof UiDataReferenceSchema>;
  format: "currency" | "number" | "percentage" | "text";
  currencyPath?: string | undefined;
}

interface ChartNode {
  id: string;
  type: "chart";
  title: string;
  chartType: "bar" | "line" | "pie";
  data: z.infer<typeof UiDataReferenceSchema>;
  categoryKey: string;
  series: Array<{ key: string; label: string }>;
}

interface HeatmapNode {
  id: string;
  type: "heatmap";
  title: string;
  data: z.infer<typeof UiDataReferenceSchema>;
  xKey: string;
  xLabel: string;
  yKey: string;
  yLabel: string;
  valueKey: string;
  valueLabel: string;
}

interface TableNode {
  id: string;
  type: "table";
  title: string;
  data: z.infer<typeof UiDataReferenceSchema>;
  columns: Array<{ key: string; label: string }>;
  maxRows: number;
}

interface FormNode {
  id: string;
  type: "form";
  title: string;
  fields: Array<z.infer<typeof FormFieldSchema>>;
  submitLabel: string;
}

interface FilterNode {
  id: string;
  type: "filters";
  fields: Array<z.infer<typeof FilterFieldSchema>>;
}

interface TabsNode {
  id: string;
  type: "tabs";
  tabs: Array<{ id: string; label: string; children: UiNode[] }>;
}

interface AlertNode {
  id: string;
  type: "alert";
  severity: "info" | "success" | "warning" | "error";
  text: string;
}

interface ButtonNode {
  id: string;
  type: "button";
  label: string;
  action: z.infer<typeof ButtonActionSchema>;
}

interface SliderNode {
  id: string;
  type: "slider";
  label: string;
  min: number;
  max: number;
  step: number;
  initialValue: number;
  showValue: boolean;
}

export type UiNode =
  | DashboardNode
  | StackNode
  | GridNode
  | CardNode
  | TextNode
  | MetricNode
  | ChartNode
  | HeatmapNode
  | TableNode
  | FormNode
  | FilterNode
  | TabsNode
  | AlertNode
  | ButtonNode
  | SliderNode;

export const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({
    id: UiIdSchema,
    type: z.literal("dashboard"),
    title: z.string().trim().min(1).max(160),
    children: z.array(UiNodeSchema).max(MAX_CHILDREN),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("stack"),
    direction: z.enum(["horizontal", "vertical"]),
    children: z.array(UiNodeSchema).max(MAX_CHILDREN),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("grid"),
    columnCount: z.number().int().min(1).max(4),
    children: z.array(UiNodeSchema).max(MAX_CHILDREN),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("card"),
    title: z.string().trim().min(1).max(160).optional(),
    children: z.array(UiNodeSchema).max(MAX_CHILDREN),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("text"),
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    variant: z.enum(["title", "subtitle", "body", "caption"]),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("metric"),
    label: z.string().trim().min(1).max(100),
    value: UiDataReferenceSchema,
    format: z.enum(["currency", "number", "percentage", "text"]),
    currencyPath: DataKeySchema.optional(),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("chart"),
    title: z.string().trim().min(1).max(160),
    chartType: z.enum(["bar", "line", "pie"]),
    data: UiDataReferenceSchema,
    categoryKey: DataKeySchema,
    series: z.array(z.object({
      key: DataKeySchema,
      label: z.string().trim().min(1).max(100),
    }).strict()).min(1).max(8),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("heatmap"),
    title: z.string().trim().min(1).max(160),
    data: UiDataReferenceSchema,
    xKey: DataKeySchema,
    xLabel: z.string().trim().min(1).max(100),
    yKey: DataKeySchema,
    yLabel: z.string().trim().min(1).max(100),
    valueKey: DataKeySchema,
    valueLabel: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("table"),
    title: z.string().trim().min(1).max(160),
    data: UiDataReferenceSchema,
    columns: z.array(z.object({
      key: DataKeySchema,
      label: z.string().trim().min(1).max(100),
    }).strict()).min(1).max(12),
    maxRows: z.number().int().min(1).max(100),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("form"),
    title: z.string().trim().min(1).max(160),
    fields: z.array(FormFieldSchema).min(1).max(12),
    submitLabel: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("filters"),
    fields: z.array(FilterFieldSchema).min(1).max(12),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("tabs"),
    tabs: z.array(z.object({
      id: UiIdSchema,
      label: z.string().trim().min(1).max(80),
      children: z.array(UiNodeSchema).max(MAX_CHILDREN),
    }).strict()).min(1).max(8),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("alert"),
    severity: z.enum(["info", "success", "warning", "error"]),
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("button"),
    label: z.string().trim().min(1).max(80),
    action: ButtonActionSchema,
  }).strict(),
  z.object({
    id: UiIdSchema,
    type: z.literal("slider"),
    label: z.string().trim().min(1).max(100),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite().max(1_000_000),
    initialValue: z.number().finite(),
    showValue: z.boolean(),
  }).strict(),
]));

export const UiDocumentSchema = z.object({
  version: z.literal(UI_DSL_VERSION),
  root: UiNodeSchema,
}).strict().superRefine(validateDocumentComplexity);

export type UiDocument = z.infer<typeof UiDocumentSchema>;
export type UiDataSource = z.infer<typeof UiDataSourceSchema>;
export type UiDataReference = z.infer<typeof UiDataReferenceSchema>;

export function parseUiDocument(
  input: unknown,
  dataSources: UiDataSource[],
): UiDocument {
  validatePayloadComplexity(input);
  const document = UiDocumentSchema.parse(input);
  validateDataBindings(document, dataSources);
  return document;
}

function validateDocumentComplexity(
  document: { version: typeof UI_DSL_VERSION; root: UiNode },
  context: z.RefinementCtx,
): void {
  const nodes = collectNodes(document.root);
  if (nodes.some(hasEmptyContainer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "La UI contiene un contenedor vacío" });
  }
  if (nodes.length > MAX_UI_NODES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "La UI supera el límite de nodos" });
  }

  const ids = nodes.flatMap((node) => [node.id, ...getNestedIds(node)]);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "La UI contiene identificadores duplicados" });
  }

  const maxDepth = calculateDepth(document.root);
  if (maxDepth > MAX_UI_DEPTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "La UI supera la profundidad permitida" });
  }

  validateActionTargets(nodes, context);
  for (const node of nodes) {
    if (node.type !== "slider") continue;
    if (node.min >= node.max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "El mínimo del slider debe ser menor que el máximo" });
    }
    if (node.initialValue < node.min || node.initialValue > node.max) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "El valor inicial del slider está fuera del rango" });
    }
  }
}

function hasEmptyContainer(node: UiNode): boolean {
  if (node.type === "tabs") return node.tabs.some((tab) => tab.children.length === 0);
  return "children" in node && node.children.length === 0;
}

function collectNodes(root: UiNode): UiNode[] {
  return [root, ...getChildren(root).flatMap(collectNodes)];
}

function getChildren(node: UiNode): UiNode[] {
  if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children);
  if ("children" in node) return node.children;
  return [];
}

function getNestedIds(node: UiNode): string[] {
  if (node.type === "tabs") return node.tabs.map((tab) => tab.id);
  if (node.type === "form" || node.type === "filters") {
    return node.fields.map((field) => field.id);
  }
  return [];
}

function calculateDepth(node: UiNode): number {
  const children = getChildren(node);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(calculateDepth));
}

function validateActionTargets(nodes: UiNode[], context: z.RefinementCtx): void {
  const nodeTypes = new Map(nodes.map((node) => [node.id, node.type]));
  const tabs = new Map(
    nodes
      .filter((node): node is TabsNode => node.type === "tabs")
      .map((node) => [node.id, new Set(node.tabs.map((tab) => tab.id))]),
  );

  for (const node of nodes) {
    if (
      node.type !== "button"
      || node.action.type === "refresh"
      || node.action.type === "confirm-payment"
    ) continue;
    const action = node.action;
    const isValid = action.type === "apply-filters"
      ? nodeTypes.get(action.filterId) === "filters"
      : action.type === "submit-form"
      ? nodeTypes.get(action.formId) === "form"
      : tabs.get(action.tabsId)?.has(action.tabId) === true;
    if (!isValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La UI contiene una acción con destino inválido",
      });
    }
  }
}

function validateDataBindings(document: UiDocument, dataSources: UiDataSource[]): void {
  const sourceData = new Map(dataSources.map((source) => [source.id, source.data]));

  for (const node of collectNodes(document.root)) {
    if (node.type === "metric") {
      const value = resolveDataReference(node.value, sourceData);
      if (value !== null && typeof value === "object") {
        throw new UiDocumentValidationError("La métrica no referencia un valor escalar");
      }
    }
    if (node.type === "chart" || node.type === "heatmap" || node.type === "table") {
      const value = resolveDataReference(node.data, sourceData);
      if (!Array.isArray(value)) {
        throw new UiDocumentValidationError("La visualización no referencia una colección");
      }
      validateCollectionBindings(node, value);
    }
  }
}

function validateCollectionBindings(
  node: ChartNode | HeatmapNode | TableNode,
  rows: unknown[],
): void {
  const paths = node.type === "chart"
    ? [node.categoryKey, ...node.series.map((series) => series.key)]
    : node.type === "heatmap"
    ? [node.xKey, node.yKey, node.valueKey]
    : node.columns.map((column) => column.key);

  for (const row of rows) {
    for (const path of paths) {
      const value = readUiDataPath(row, path);
      if (value !== null && typeof value === "object") {
        throw new UiDocumentValidationError("La visualización referencia un valor no escalar");
      }
    }
  }
}

export function resolveUiDataReference(
  reference: UiDataReference,
  dataSources: UiDataSource[],
): unknown {
  return resolveDataReference(
    reference,
    new Map(dataSources.map((source) => [source.id, source.data])),
  );
}

function resolveDataReference(
  reference: UiDataReference,
  sourceData: ReadonlyMap<string, unknown>,
): unknown {
  if (!sourceData.has(reference.sourceId)) {
    throw new UiDocumentValidationError("La UI usa una fuente no autorizada");
  }

  const value = sourceData.get(reference.sourceId);
  return reference.path ? readUiDataPath(value, reference.path) : value;
}

export function readUiDataPath(value: unknown, path: string): unknown {
  let currentValue = value;
  for (const key of path.split(".")) {
    if (!currentValue || typeof currentValue !== "object" || !Object.hasOwn(currentValue, key)) {
      throw new UiDocumentValidationError("La UI usa una ruta de datos inexistente");
    }
    currentValue = (currentValue as Record<string, unknown>)[key];
  }
  return currentValue;
}

function validatePayloadComplexity(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 1 }];
  let valueCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    valueCount += 1;
    if (valueCount > MAX_UI_JSON_VALUES || current.depth > MAX_UI_JSON_DEPTH) {
      throw new UiDocumentValidationError("La UI supera los límites de complejidad");
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const value of Object.values(current.value)) {
      pending.push({ value, depth: current.depth + 1 });
    }
  }
}

function isForbiddenDataKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

export class UiDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiDocumentValidationError";
  }
}
