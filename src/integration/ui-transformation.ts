import {
  uiSpecificationSchema,
  type DataRegistryValue,
  type TableColumn,
  type UINode,
  type UISpecification,
  type VisualizationNode,
} from "@banorte/contracts";

export interface UiTransformationResult {
  specification: UISpecification;
  answer: string;
  operation: "remove" | "preserve" | "replace" | "configure" | "reorder";
}

/**
 * Applies presentation-only follow-ups to the persisted shared UI contract.
 * The function is deliberately pure: it cannot fetch or mutate financial data.
 */
export function transformPersistedUi(options: {
  specification: UISpecification;
  dataRegistry: DataRegistryValue;
  prompt: string;
}): UiTransformationResult | null {
  const request = normalize(options.prompt);
  const removeCharts = requestsRemoval(request, /\bgrafic[a-z]*\b|\bvisualiz[a-z]*\b/u);
  const removeTables = requestsRemoval(request, /\btabl[a-z]*\b|\btabal[a-z]*\b/u);
  const onlyTables = requestsOnly(request, /\btabl[a-z]*\b|\btabal[a-z]*\b/u);
  const onlyCharts = requestsOnly(request, /\bgrafic[a-z]*\b|\bvisualiz[a-z]*\b/u);
  const convertToTable = /\b(?:conviert|convert|transform)[a-z]*\b.{0,80}\btabl[a-z]*\b/u.test(request);
  const sortable = /\b(?:ordenable|ordenar|ordena|sortable)\b/u.test(request);
  const onlyLargestChange = /\b(?:unicamente|solamente|solo)\b.{0,80}\b(?:cambio|variacion|diferencia)\b.{0,40}\b(?:mayor|mas\s+grande|mas\s+importante|principal)\b/u.test(request)
    || /\b(?:cambio|variacion|diferencia)\b.{0,40}\b(?:mayor|mas\s+grande|mas\s+importante|principal)\b/u.test(request);
  const reorder = parseReorderRequest(request);

  let nextRoot: UINode | undefined;
  let answer: string;
  let operation: UiTransformationResult["operation"];

  if (onlyLargestChange) {
    nextRoot = createLargestChangeView(options.specification.root, options.dataRegistry);
    answer = "Dejé únicamente la evidencia del cambio financiero más grande, sin volver a consultar ni modificar tus datos.";
    operation = "preserve";
  } else if (convertToTable) {
    nextRoot = mapTree(options.specification.root, (node) => (
      node.type === "visualization" ? visualizationToTable(node) : node
    ));
    answer = "Convertí la evidencia visual en una tabla ordenable usando exactamente los mismos datos financieros.";
    operation = "replace";
  } else if (removeCharts || removeTables || onlyTables || onlyCharts) {
    nextRoot = filterTree(options.specification.root, (node) => {
      if (onlyTables) return node.type === "table" || isStructuralNode(node);
      if (onlyCharts) return node.type === "visualization" || isStructuralNode(node);
      if ((removeCharts || onlyTables) && node.type === "visualization") return false;
      if ((removeTables || onlyCharts) && node.type === "table") return false;
      return true;
    }, onlyTables || onlyCharts);
    answer = onlyTables
      ? "Dejé sólo las tablas financieras y conservé sus datos."
      : onlyCharts
        ? "Dejé sólo las gráficas financieras y conservé sus datos."
        : `Quité ${removeCharts ? "las gráficas" : "las tablas"} de la interfaz y conservé el resto del análisis financiero y sus datos.`;
    operation = onlyTables || onlyCharts ? "preserve" : "remove";
  } else if (reorder) {
    nextRoot = reorderEvidence(options.specification.root, reorder.target, reorder.position);
    answer = `Reordené ${reorder.target === "table" ? "las tablas" : "las gráficas"} en la interfaz sin modificar los datos financieros.`;
    operation = "reorder";
  } else if (sortable) {
    nextRoot = mapTree(options.specification.root, (node) => node.type === "table"
      ? {
          ...node,
          columns: node.columns.map((column) => ({ ...column, sortable: true })),
          sorting: { enabled: true },
        }
      : node);
    answer = "Habilité el ordenamiento de la tabla sin cambiar los datos financieros mostrados.";
    operation = "configure";
  } else {
    return null;
  }

  if (!nextRoot) {
    nextRoot = {
      type: "section",
      ...(options.specification.root.id ? { id: options.specification.root.id } : {}),
      ariaLabel: "Vista financiera actualizada",
      children: [{
        type: "alert",
        id: "gen2-empty-presentation",
        message: "El elemento solicitado fue retirado. Tus datos financieros siguen disponibles para otra presentación.",
        semanticState: "status.info",
      }],
    };
  }

  const parsed = uiSpecificationSchema.parse({
    version: options.specification.version,
    root: nextRoot,
  });
  return { specification: parsed, answer, operation };
}

function requestsRemoval(request: string, subject: RegExp): boolean {
  const clauses = request.split(/\s*;\s*|\b(?:y|pero)\s+(?=(?:dej|conserv|muestr|ensen|quier)[a-z]*\b)/u);
  return clauses.some((clause) => (
    /\b(?:quit|elimin|ocult|suprim|retir)[a-z]*\b/u.test(clause)
      || /\bsin\b/u.test(clause)
  ) && subject.test(clause));
}

function requestsOnly(request: string, subject: RegExp): boolean {
  const pattern = new RegExp(
    `\\b(?:dej|conserv|muestr|ensen|quier)[a-z]*\\b.{0,60}\\b(?:unicamente|solamente|solo)\\b.{0,40}(?:${subject.source})`,
    "u",
  );
  return pattern.test(request);
}

function parseReorderRequest(request: string): { target: "table" | "visualization"; position: "before" | "after" } | undefined {
  if (!/\b(?:mueve|mover|pon|coloca|orden[a-z]*|sube|prioriza)\b/u.test(request)) return undefined;
  const tableIndex = request.search(/\btabl[a-z]*\b/u);
  const chartIndex = request.search(/\bgrafic[a-z]*\b|\bvisualiz[a-z]*\b/u);
  if (tableIndex < 0 && chartIndex < 0) return undefined;
  if (!/\b(?:antes|primero|arriba|despues|abajo|final)\b/u.test(request)) return undefined;
  const target = tableIndex >= 0 && (chartIndex < 0 || tableIndex < chartIndex) ? "table" : "visualization";
  const position = /\b(?:despues|abajo|final)\b/u.test(request) ? "after" : "before";
  return { target, position };
}

function reorderEvidence(root: UINode, target: "table" | "visualization", position: "before" | "after"): UINode {
  const counterpart = target === "table" ? "visualization" : "table";
  return mapTree(root, (node) => {
    if (!("children" in node)) return node;
    const children = [...node.children];
    const targetIndex = children.findIndex((child) => child.type === target);
    const counterpartIndex = children.findIndex((child) => child.type === counterpart);
    if (targetIndex < 0 || counterpartIndex < 0) return node;
    if ((position === "before" && targetIndex < counterpartIndex)
      || (position === "after" && targetIndex > counterpartIndex)) return node;
    const [moving] = children.splice(targetIndex, 1);
    if (!moving) return node;
    children.splice(counterpartIndex, 0, moving);
    return { ...node, children } as UINode;
  });
}

function visualizationToTable(node: VisualizationNode): UINode {
  const channels = [node.encoding.x, node.encoding.y, node.encoding.group, node.encoding.value]
    .filter((channel): channel is NonNullable<typeof channel> => channel !== undefined);
  const seen = new Set<string>();
  const columns: TableColumn[] = channels.flatMap((channel) => {
    if (seen.has(channel.field)) return [];
    seen.add(channel.field);
    return [{
      field: channel.field,
      label: labelFromKey(channel.field, channel.label),
      format: inferColumnFormat(channel.field, channel.label, channel.type),
      sortable: true,
    }];
  });
  const quantitative = channels.find((channel) => channel.type === "quantitative");
  return {
    type: "table",
    id: node.id,
    ariaLabel: `Tabla: ${node.ariaLabel}`.slice(0, 160),
    dataBinding: node.dataBinding,
    columns,
    sorting: {
      enabled: true,
      ...(quantitative ? { default: { field: quantitative.field, direction: "descending" as const } } : {}),
    },
    filtering: { enabled: true, fields: columns.map((column) => column.field) },
    pagination: { pageSize: 10 },
    stickyHeader: true,
  };
}

function createLargestChangeView(root: UINode, registry: DataRegistryValue): UINode {
  const candidate = findLargestVisibleTableChange(root, registry) ?? findLargestChange(registry);
  if (!candidate) {
    const evidence = findFirst(root, (node) => node.type === "metric" || node.type === "visualization" || node.type === "table");
    return evidence ? retainPath(root, evidence.id) ?? root : root;
  }
  return {
    type: "section",
    id: root.id ?? "gen2-primary-change",
    ariaLabel: "Cambio financiero más grande",
    surface: "primary",
    padding: "md",
    children: [
      { type: "heading", id: "gen2-primary-change-title", content: "Cambio más grande", level: 2 },
      {
        type: "metric",
        id: "gen2-primary-change-value",
        label: candidate.label,
        valueBinding: candidate.binding,
        format: candidate.format,
        importance: "primary",
        semanticState: candidate.value < 0 ? "financial.negative" : "financial.neutral",
      },
    ],
  };
}

interface NumericCandidate {
  binding: string;
  label: string;
  value: number;
  format: "currency" | "percent" | "number";
  priority: number;
}

function findLargestVisibleTableChange(root: UINode, registry: DataRegistryValue): NumericCandidate | undefined {
  const table = findFirst(root, (node) => node.type === "table"
    && node.columns.some((column) => /(?:absolutechange|difference|diferencia|delta|variacion|change)/iu.test(column.field)));
  if (table?.type !== "table") return undefined;
  const changeColumn = table.columns.find((column) => /(?:absolutechange|difference|diferencia|delta|variacion|change)/iu.test(column.field));
  if (!changeColumn) return undefined;
  const rows = resolveRegistryPath(registry, table.dataBinding);
  if (!Array.isArray(rows)) return undefined;
  const labelColumn = table.columns.find((column) => /(?:category|categoria|description|descripcion|name|nombre)/iu.test(column.field));
  const candidates = rows.flatMap((row, index) => {
    const raw = resolveRegistryPath(row, changeColumn.field);
    const value = parseFiniteNumber(raw);
    if (value === undefined || !isSafeBinding([...table.dataBinding.split("."), String(index), ...changeColumn.field.split(".")])) return [];
    const label = labelColumn ? resolveRegistryPath(row, labelColumn.field) : undefined;
    return [{
      binding: `${table.dataBinding}.${index}.${changeColumn.field}`,
      label: typeof label === "string" ? label : changeColumn.label,
      value,
      format: changeColumn.format === "percentage" ? "percent" as const : "currency" as const,
      priority: 4,
    }];
  });
  return candidates.sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0];
}

function resolveRegistryPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^(?:0|[1-9][0-9]*)$/u.test(segment)) return current[Number(segment)];
    return isRecord(current) ? current[segment] : undefined;
  }, root);
}

function findLargestChange(registry: DataRegistryValue): NumericCandidate | undefined {
  const candidates: NumericCandidate[] = [];
  const walk = (value: unknown, path: string[], parent?: Record<string, unknown>): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)], isRecord(item) ? item : parent));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key], value);
      return;
    }
    const number = parseFiniteNumber(value);
    const key = path.at(-1) ?? "";
    if (number === undefined || !isSafeBinding(path)) return;
    const priority = /(?:difference|diferencia|delta|change|cambio|variation|variacion)/u.test(key) ? 3
      : /(?:amount|monto|expense|gasto)/u.test(key) ? 2
      : /(?:percentage|percent|porcentaje|rate)/u.test(key) ? 1 : 0;
    if (priority === 0) return;
    const descriptor = parent && ["category", "categoria", "description", "descripcion", "name", "nombre", "label"]
      .map((field) => parent[field]).find((item) => typeof item === "string");
    candidates.push({
      binding: path.join("."),
      label: typeof descriptor === "string" ? descriptor : labelFromKey(key),
      value: number,
      format: /(?:percentage|percent|porcentaje|rate)/u.test(key) ? "percent" : priority >= 2 ? "currency" : "number",
      priority,
    });
  };
  walk(registry, []);
  return candidates.sort((left, right) => right.priority - left.priority || Math.abs(right.value) - Math.abs(left.value))[0];
}

function filterTree(node: UINode, keep: (node: UINode) => boolean, pruneEmpty = false): UINode | undefined {
  if (!keep(node)) return undefined;
  if ("children" in node) {
    const children = node.children.flatMap((child) => {
      const result = filterTree(child, keep, pruneEmpty);
      return result ? [result] : [];
    });
    if (node.type === "split" && children.length < 2) return children[0];
    if (pruneEmpty && children.length === 0) return undefined;
    return { ...node, children } as UINode;
  }
  if (node.type === "tabs" || node.type === "accordion") {
    const items = node.items.map((item) => ({
      ...item,
      children: item.children.flatMap((child) => {
        const result = filterTree(child, keep, pruneEmpty);
        return result ? [result] : [];
      }),
    })).filter((item) => item.children.length > 0);
    return items.length > 0 ? { ...node, items } as UINode : undefined;
  }
  if (node.type === "repeat") {
    const template = filterTree(node.template, keep, pruneEmpty);
    const empty = node.empty ? filterTree(node.empty, keep, pruneEmpty) : undefined;
    return template ? { ...node, template, ...(empty ? { empty } : {}) } as UINode : undefined;
  }
  if (node.type === "conditional") {
    const then = filterTree(node.then, keep, pruneEmpty);
    const otherwise = node.else ? filterTree(node.else, keep, pruneEmpty) : undefined;
    return then ? { ...node, then, ...(otherwise ? { else: otherwise } : {}) } as UINode : otherwise;
  }
  return node;
}

function mapTree(node: UINode, mapper: (node: UINode) => UINode): UINode {
  let mapped: UINode = node;
  if ("children" in node) mapped = { ...node, children: node.children.map((child) => mapTree(child, mapper)) } as UINode;
  else if (node.type === "tabs" || node.type === "accordion") mapped = { ...node, items: node.items.map((item) => ({ ...item, children: item.children.map((child) => mapTree(child, mapper)) })) } as UINode;
  else if (node.type === "repeat") mapped = { ...node, template: mapTree(node.template, mapper), ...(node.empty ? { empty: mapTree(node.empty, mapper) } : {}) };
  else if (node.type === "conditional") mapped = { ...node, then: mapTree(node.then, mapper), ...(node.else ? { else: mapTree(node.else, mapper) } : {}) };
  return mapper(mapped);
}

function findFirst(node: UINode, predicate: (node: UINode) => boolean): UINode | undefined {
  if (predicate(node)) return node;
  if ("children" in node) for (const child of node.children) { const match = findFirst(child, predicate); if (match) return match; }
  if (node.type === "tabs" || node.type === "accordion") for (const item of node.items) for (const child of item.children) { const match = findFirst(child, predicate); if (match) return match; }
  return undefined;
}

function retainPath(node: UINode, targetId: string | undefined): UINode | undefined {
  if (node.id === targetId) return node;
  if (!("children" in node)) return undefined;
  for (const child of node.children) {
    const retained = retainPath(child, targetId);
    if (retained) return { ...node, children: [retained] } as UINode;
  }
  return undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeBinding(path: string[]): boolean {
  return path.length > 0 && path.every((segment) => /^(?:[a-zA-Z_][a-zA-Z0-9_]*|0|[1-9][0-9]{0,5})$/u.test(segment));
}

function labelFromKey(key: string, proposed?: string): string {
  const lower = key.toLocaleLowerCase("es-MX");
  if (/(?:^|\.)(?:category|categoria)$/u.test(lower)) return "Categoría";
  if (/(?:^|\.)(?:amount|monto)$/u.test(lower)) return proposed && proposed.length <= 40 ? proposed : "Monto";
  if (/(?:^|\.)(?:percentage|porcentaje)$/u.test(lower)) return "Porcentaje";
  return proposed && proposed.length <= 40 ? proposed : key.replaceAll("_", " ").replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (letter) => letter.toLocaleUpperCase("es-MX"));
}

function inferColumnFormat(field: string, label: string | undefined, type: string): TableColumn["format"] {
  if (/(?:amount|monto|expenses?|gastos?|income|ingresos?|balance|saldo)/iu.test(field)) return "currency";
  if (/(?:percentage|porcentaje|percent|ratio|share)/iu.test(field)) return "percentage";
  if (type === "temporal") return "date";
  if (type === "quantitative") return /(?:monto|gasto|ingreso|saldo)/iu.test(label ?? "") ? "currency" : "number";
  return "text";
}

function isStructuralNode(node: UINode): boolean {
  return "children" in node || node.type === "tabs" || node.type === "accordion"
    || node.type === "repeat" || node.type === "conditional";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-MX").trim();
}
