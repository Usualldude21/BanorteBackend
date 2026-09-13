import {
  CONTRACT_VERSION,
  dataRegistryContractSchema,
  uiPatchSchema,
  uiSpecificationSchema,
  type DataRegistry,
  type UIPatch,
  type UISpecification,
  type UINode,
} from "@banorte/contracts";
import { adaptUiDataSource } from "./shared-contract-adapter.js";
import { type UiDataSource } from "../ui/dsl/ui.schema.js";

interface ProvisionalUiPayload {
  specification: UISpecification;
  dataRegistry: DataRegistry;
}

interface CollectionCandidate {
  binding: string;
  records: Array<Record<string, unknown>>;
}

interface ScalarCandidate {
  binding: string;
  key: string;
  value: string | number | boolean | null;
}

const MAX_PROVISIONAL_COLUMNS = 6;
const MAX_SEARCH_DEPTH = 3;
const bindingSegmentPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const excludedFieldPattern = /(?:^|_)(?:id|uuid|token|secret|password|user|owner|created|updated|deleted)(?:_|$)|(?:Id|ID|Uuid|UUID|At)$/u;
const percentageFieldPattern = /(?:percentage|rate|ratio|share|score|change)$/iu;
const currencyFieldPattern = /(?:amount|balance|income|expenses?|fee|margin|cashflow)$/iu;
const fieldLabels: Record<string, string> = {
  amount: "Monto",
  category: "Categoría",
  currency: "Moneda",
  percentage: "Porcentaje",
  transactionCount: "Transacciones",
  transaction_count: "Transacciones",
};

export function createProvisionalUiPayload(
  source: UiDataSource,
  revision: number,
  sourceOffset = 0,
): ProvisionalUiPayload | null {
  const adaptedSource = adaptUiDataSource(source, sourceOffset);
  const collection = findCollection(adaptedSource.value, adaptedSource.key);
  const scalar = collection ? undefined : findScalar(adaptedSource.value, adaptedSource.key);
  const root = collection
    ? createCollectionPreview(collection)
    : scalar
      ? createScalarPreview(scalar)
      : undefined;

  if (!root) return null;

  return {
    specification: uiSpecificationSchema.parse({ version: CONTRACT_VERSION, root }),
    dataRegistry: dataRegistryContractSchema.parse({
      version: CONTRACT_VERSION,
      revision,
      data: { [adaptedSource.key]: adaptedSource.value },
    }),
  };
}

export function createSharedUiPatch(
  current: UISpecification,
  next: UISpecification,
  baseRevision: number,
): UIPatch {
  const appendedChild = findSingleAppendedChild(current.root, next.root);
  const removedChild = findSingleRemovedChild(current.root, next.root);
  const replacedChild = findSingleReplacedChild(current.root, next.root);
  const propertyChanges = findPropertyChanges(current.root, next.root);
  return uiPatchSchema.parse(
    appendedChild
      ? {
      version: "1",
      baseRevision,
      revision: baseRevision + 1,
      op: "add",
      target: current.root.id,
      node: appendedChild,
    }
      : removedChild
        ? {
          version: "1",
          baseRevision,
          revision: baseRevision + 1,
          op: "remove",
          target: removedChild.id,
        }
        : replacedChild
          ? {
            version: "1",
            baseRevision,
            revision: baseRevision + 1,
            op: "replace",
            target: replacedChild.current.id,
            node: replacedChild.next,
          }
          : propertyChanges
            ? {
              version: "1",
              baseRevision,
              revision: baseRevision + 1,
              op: "update",
              target: current.root.id,
              changes: propertyChanges,
            }
            : {
      version: "1",
      baseRevision,
      revision: baseRevision + 1,
      op: "replace",
      target: current.root.id,
      node: next.root,
    },
  );
}

/** Ordered patches; a compatible container is retained when its children change. */
export function createSharedUiPatches(current: UISpecification, next: UISpecification, baseRevision: number): UIPatch[] {
  const patches: UIPatch[] = [];
  const emit = (patch: Record<string, unknown>) => patches.push(uiPatchSchema.parse({
    version: "1", baseRevision: baseRevision + patches.length,
    revision: baseRevision + patches.length + 1, ...patch,
  }));
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const diff = (before: UINode, after: UINode): void => {
    if (equal(before, after)) return;
    if (before.id === after.id && before.type === after.type
      && "children" in before && "children" in after) {
      const { children: oldChildren, ...oldProperties } = before;
      const { children: newChildren, ...newProperties } = after;
      const oldIds = oldChildren.map((child) => child.id);
      const newIds = newChildren.map((child) => child.id);
      const retainedOld = oldIds.filter((id) => newIds.includes(id));
      const retainedNew = newIds.filter((id) => oldIds.includes(id));
      const additions = newChildren.filter((child) => !oldIds.includes(child.id));
      // Contract add appends: never silently change the requested order.
      const appendOnly = equal([...retainedNew, ...additions.map((child) => child.id)], newIds);
      const removedProperties = Object.keys(oldProperties).some((key) => !(key in newProperties));
      if (!removedProperties && equal(retainedOld, retainedNew) && appendOnly
        && oldIds.every(Boolean) && newIds.every(Boolean)) {
        const changes = Object.fromEntries(Object.entries(newProperties).filter(([key, value]) => key !== "id" && key !== "type" && !equal(Reflect.get(oldProperties, key), value)));
        if (Object.keys(changes).length) emit({ op: "update", target: before.id, changes });
        for (const child of oldChildren) if (!newIds.includes(child.id)) emit({ op: "remove", target: child.id });
        for (const child of newChildren) {
          const existing = oldChildren.find((candidate) => candidate.id === child.id);
          if (existing) diff(existing, child);
          else emit({ op: "add", target: before.id, node: child });
        }
        return;
      }
    }
    const changes = findPropertyChanges(before, after);
    // Removed properties cannot be represented by update; replacement is safe.
    const hasRemovedProperty = Object.keys(before).some((key) => !(key in after));
    if (changes && !hasRemovedProperty) emit({ op: "update", target: before.id, changes });
    else emit({ op: "replace", target: before.id, node: after });
  };
  diff(current.root, next.root);
  return patches;
}

function findSingleAppendedChild(current: UINode, next: UINode): UINode | undefined {
  if (current.id !== next.id || current.type !== next.type) return undefined;
  if (!("children" in current) || !("children" in next)) return undefined;
  if (next.children.length !== current.children.length + 1) return undefined;

  const retainedChildren = next.children.slice(0, current.children.length);
  return JSON.stringify(current.children) === JSON.stringify(retainedChildren)
    ? next.children.at(-1)
    : undefined;
}

function findSingleRemovedChild(current: UINode, next: UINode): UINode | undefined {
  if (current.id !== next.id || current.type !== next.type) return undefined;
  if (!("children" in current) || !("children" in next)) return undefined;
  if (current.children.length !== next.children.length + 1) return undefined;
  const removed = current.children.filter((child) => !next.children.some((candidate) => candidate.id === child.id));
  if (removed.length !== 1) return undefined;
  const retained = current.children.filter((child) => child.id !== removed[0]?.id);
  return JSON.stringify(retained) === JSON.stringify(next.children) ? removed[0] : undefined;
}

function findSingleReplacedChild(
  current: UINode,
  next: UINode,
): { current: UINode; next: UINode } | undefined {
  if (current.id !== next.id || current.type !== next.type) return undefined;
  if (!("children" in current) || !("children" in next)) return undefined;
  if (current.children.length !== next.children.length) return undefined;
  if (current.children.some((child, index) => child.id !== next.children[index]?.id)) return undefined;
  const changed = current.children
    .map((child, index) => ({ current: child, next: next.children[index]! }))
    .filter((pair) => JSON.stringify(pair.current) !== JSON.stringify(pair.next));
  return changed.length === 1 ? changed[0] : undefined;
}

function findPropertyChanges(current: UINode, next: UINode): Record<string, unknown> | undefined {
  if (current.id !== next.id || current.type !== next.type || "children" in current || "children" in next) return undefined;
  const currentProperties = current as unknown as Record<string, unknown>;
  const nextProperties = next as unknown as Record<string, unknown>;
  const changes = Object.fromEntries(Object.entries(nextProperties).filter(([key, value]) => (
    key !== "id" && key !== "type" && JSON.stringify(currentProperties[key]) !== JSON.stringify(value)
  )));
  return Object.keys(changes).length > 0 ? changes : undefined;
}

function createCollectionPreview(collection: CollectionCandidate): UINode {
  const fields = collectSafeFields(collection.records).slice(0, MAX_PROVISIONAL_COLUMNS);
  return {
    type: "section",
    id: "provisional-root",
    ariaLabel: "Datos financieros disponibles",
    surface: "primary",
    children: [
      {
        type: "heading",
        id: "provisional-heading",
        content: "Datos disponibles",
        level: 2,
      },
      {
        type: "table",
        id: "provisional-table",
        ariaLabel: "Vista preliminar de los datos recuperados",
        dataBinding: collection.binding,
        columns: fields.map((field) => ({
          field,
          label: labelFromKey(field),
          format: inferTableFormat(collection.records, field),
        })),
        pagination: { pageSize: 10 },
      },
    ],
  };
}

function createScalarPreview(scalar: ScalarCandidate): UINode {
  return {
    type: "section",
    id: "provisional-root",
    ariaLabel: "Resultado financiero disponible",
    surface: "primary",
    children: [{
      type: "metric",
      id: "provisional-metric",
      label: labelFromKey(scalar.key),
      valueBinding: scalar.binding,
      format: inferScalarFormat(scalar.value),
    }],
  };
}

function findCollection(value: unknown, binding: string, depth = 0): CollectionCandidate | undefined {
  if (depth > MAX_SEARCH_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    const usefulFields = collectSafeFields(records).filter((field) => field !== "currency" && field !== "dataType");
    if (records.length === value.length && records.length > 0 && usefulFields.length >= 2) {
      return { binding, records };
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const [key, child] of Object.entries(value)) {
    if (!isSafeField(key)) continue;
    const candidate = findCollection(child, `${binding}.${key}`, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
}

function findScalar(value: unknown, binding: string, depth = 0): ScalarCandidate | undefined {
  if (depth > MAX_SEARCH_DEPTH || !isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(([key]) => isSafeField(key));
  const scalarEntries = entries.filter((entry): entry is [string, string | number | boolean | null] => isScalar(entry[1]));
  const preferred = scalarEntries.find(([key, child]) => typeof child === "number"
    && key !== "dataType" && key !== "currency");
  if (preferred) {
    return { key: preferred[0], value: preferred[1], binding: `${binding}.${preferred[0]}` };
  }

  for (const [key, child] of entries) {
    const candidate = findScalar(child, `${binding}.${key}`, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
}

function collectSafeFields(records: Array<Record<string, unknown>>): string[] {
  return [...new Set(records.slice(0, 20).flatMap((record) => Object.keys(record)))]
    .filter(isSafeField)
    .filter((field) => records.some((record) => isScalar(record[field])));
}

function isSafeField(field: string): boolean {
  return bindingSegmentPattern.test(field) && !excludedFieldPattern.test(field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function inferTableFormat(records: Array<Record<string, unknown>>, field: string) {
  const sample = records.find((record) => record[field] !== null)?.[field];
  if (typeof sample === "number" && percentageFieldPattern.test(field)) return "percentage" as const;
  if ((typeof sample === "number" || typeof sample === "string") && currencyFieldPattern.test(field)) {
    return "currency" as const;
  }
  if (typeof sample === "number") return "number" as const;
  if (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/u.test(sample)) return "date" as const;
  return "text" as const;
}

function inferScalarFormat(value: ScalarCandidate["value"]) {
  if (typeof value === "number") return "number" as const;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value)) return "date" as const;
  return "text" as const;
}

function labelFromKey(key: string): string {
  const knownLabel = fieldLabels[key];
  if (knownLabel) return knownLabel;
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase())
    .slice(0, 80);
}
