import { z } from "zod";
import {
  parseUiDocument,
  UiDataSourcesSchema,
  UiDocumentSchema,
  UiNodeSchema,
  type UiDataSource,
  type UiDocument,
  type UiNode,
} from "../dsl/ui.schema.js";

const MAX_PATCH_OPERATIONS = 100;
const MAX_PATCH_JSON_DEPTH = 32;
const MAX_PATCH_JSON_VALUES = 100_000;
const UiIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const UiPatchOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace-root"), node: UiNodeSchema }).strict(),
  z.object({
    type: z.literal("replace-node"),
    targetId: UiIdSchema,
    node: UiNodeSchema,
  }).strict(),
  z.object({ type: z.literal("remove-node"), targetId: UiIdSchema }).strict(),
  z.object({
    type: z.literal("append-child"),
    parentId: UiIdSchema,
    node: UiNodeSchema,
  }).strict(),
]);

export const UiPatchSchema = z.object({
  version: z.literal("1.0"),
  operations: z.array(UiPatchOperationSchema).max(MAX_PATCH_OPERATIONS),
  dataSources: UiDataSourcesSchema,
}).strict();

export type UiPatch = z.infer<typeof UiPatchSchema>;
export type UiPatchOperation = z.infer<typeof UiPatchOperationSchema>;

export interface PatchedUiState {
  document: UiDocument;
  dataSources: UiDataSource[];
}

export function applyUiPatch(
  currentDocument: UiDocument,
  currentDataSources: UiDataSource[],
  input: unknown,
): PatchedUiState {
  const sources = UiDataSourcesSchema.parse(currentDataSources);
  const document = parseUiDocument(currentDocument, sources);
  validatePatchPayloadComplexity(input);
  const patch = UiPatchSchema.parse(input);
  let root = document.root;

  for (const operation of patch.operations) {
    root = applyOperation(root, operation);
  }

  const nextDocument = parseUiDocument({ version: "1.0", root }, patch.dataSources);
  return { document: nextDocument, dataSources: patch.dataSources };
}

export function createUiPatch(
  currentDocument: UiDocument,
  nextDocument: UiDocument,
  nextDataSources: UiDataSource[],
): UiPatch {
  const current = UiDocumentSchema.parse(currentDocument);
  const next = parseUiDocument(nextDocument, nextDataSources);
  const operations = createOperations(current.root, next.root);
  return UiPatchSchema.parse({ version: "1.0", operations, dataSources: nextDataSources });
}

function createOperations(current: UiNode, next: UiNode): UiPatchOperation[] {
  if (!hasChildren(current) || !hasChildren(next) || !areCompatibleContainers(current, next)) {
    return isEqual(current, next) ? [] : [{ type: "replace-root", node: next }];
  }

  const currentChildren = current.children;
  const nextChildren = next.children;
  const nextById = new Map(nextChildren.map((node) => [node.id, node]));
  const currentIds = currentChildren.map((node) => node.id);
  const nextIds = nextChildren.map((node) => node.id);
  const retainedIds = currentIds.filter((id) => nextById.has(id));
  const appendedIds = nextIds.filter((id) => !currentIds.includes(id));
  if (!isEqual([...retainedIds, ...appendedIds], nextIds)) {
    return [{ type: "replace-root", node: next }];
  }

  const operations: UiPatchOperation[] = [];
  for (const child of currentChildren) {
    const replacement = nextById.get(child.id);
    if (!replacement) {
      operations.push({ type: "remove-node", targetId: child.id });
    } else if (!isEqual(child, replacement)) {
      operations.push({ type: "replace-node", targetId: child.id, node: replacement });
    }
  }
  for (const child of nextChildren) {
    if (!currentIds.includes(child.id)) {
      operations.push({ type: "append-child", parentId: current.id, node: child });
    }
  }
  return operations.length <= MAX_PATCH_OPERATIONS
    ? operations
    : [{ type: "replace-root", node: next }];
}

function applyOperation(root: UiNode, operation: UiPatchOperation): UiNode {
  if (operation.type === "replace-root") return operation.node;
  if ("targetId" in operation && operation.targetId === root.id) {
    throw new UiPatchApplicationError("La raíz solo puede cambiarse con replace-root");
  }

  if (operation.type === "append-child") {
    const result = appendChild(root, operation.parentId, operation.node);
    validateSingleMatch(result.matches, "El contenedor del parche no existe");
    return result.node;
  }

  const result = transformNode(root, operation.targetId, operation);
  validateSingleMatch(result.matches, "El destino del parche no existe");
  if (!result.node) throw new UiPatchApplicationError("El parche eliminó la raíz");
  return result.node;
}

function transformNode(
  node: UiNode,
  targetId: string,
  operation: Extract<UiPatchOperation, { type: "replace-node" | "remove-node" }>,
): { node: UiNode | null; matches: number } {
  if (node.id === targetId) {
    return {
      node: operation.type === "replace-node" ? operation.node : null,
      matches: 1,
    };
  }
  return mapChildren(node, (child) => transformNode(child, targetId, operation));
}

function appendChild(
  node: UiNode,
  parentId: string,
  child: UiNode,
): { node: UiNode; matches: number } {
  if (node.id === parentId) {
    if (!hasChildren(node)) {
      throw new UiPatchApplicationError("El destino no admite hijos");
    }
    return { node: { ...node, children: [...node.children, child] }, matches: 1 };
  }
  const result = mapChildren(node, (currentChild) => appendChild(currentChild, parentId, child));
  if (!result.node) throw new UiPatchApplicationError("El parche produjo un árbol inválido");
  return { node: result.node, matches: result.matches };
}

function mapChildren(
  node: UiNode,
  transform: (child: UiNode) => { node: UiNode | null; matches: number },
): { node: UiNode; matches: number } {
  if (node.type === "tabs") {
    let matches = 0;
    const tabs = node.tabs.map((tab) => ({
      ...tab,
      children: tab.children.flatMap((child) => {
        const result = transform(child);
        matches += result.matches;
        return result.node ? [result.node] : [];
      }),
    }));
    return { node: { ...node, tabs }, matches };
  }
  if (!hasChildren(node)) return { node, matches: 0 };

  let matches = 0;
  const children = node.children.flatMap((child) => {
    const result = transform(child);
    matches += result.matches;
    return result.node ? [result.node] : [];
  });
  return { node: { ...node, children }, matches };
}

function hasChildren(
  node: UiNode,
): node is Extract<UiNode, { type: "dashboard" | "stack" | "grid" | "card" }> {
  return node.type === "dashboard"
    || node.type === "stack"
    || node.type === "grid"
    || node.type === "card";
}

function areCompatibleContainers(
  current: Extract<UiNode, { type: "dashboard" | "stack" | "grid" | "card" }>,
  next: Extract<UiNode, { type: "dashboard" | "stack" | "grid" | "card" }>,
): boolean {
  if (current.id !== next.id || current.type !== next.type) return false;
  return isEqual(containerProperties(current), containerProperties(next));
}

function containerProperties(node: Extract<UiNode, { type: "dashboard" | "stack" | "grid" | "card" }>) {
  const { children: _children, ...properties } = node;
  return properties;
}

function validateSingleMatch(matches: number, missingMessage: string): void {
  if (matches === 0) throw new UiPatchApplicationError(missingMessage);
  if (matches > 1) throw new UiPatchApplicationError("El parche tiene un destino ambiguo");
}

function isEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePatchPayloadComplexity(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 1 }];
  let valueCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    valueCount += 1;
    if (valueCount > MAX_PATCH_JSON_VALUES || current.depth > MAX_PATCH_JSON_DEPTH) {
      throw new UiPatchApplicationError("El parche supera los límites de complejidad");
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const value of Object.values(current.value)) {
      pending.push({ value, depth: current.depth + 1 });
    }
  }
}

export class UiPatchApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiPatchApplicationError";
  }
}
