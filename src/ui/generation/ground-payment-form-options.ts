import type { UiDataSource, UiDocument, UiNode } from "../dsl/ui.schema.js";

// Repair the model's option values from the verified tool rows; never infer a
// destination from a masked account or from conversational text alone.
export function groundPaymentFormOptions(document: UiDocument, sources: UiDataSource[]): UiDocument {
  const grounded = structuredClone(document);
  const catalog = (tool: string, key: string) => {
    const data = sources.find((source) => source.toolName === tool)?.data;
    return data && typeof data === "object" && key in data && Array.isArray(data[key as keyof typeof data])
      ? (data[key as keyof typeof data] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];
  };
  const accounts = catalog("get_accounts", "accounts").filter((row) => row.status === "active" && row.type !== "credit_card");
  const beneficiaries = catalog("get_beneficiaries", "beneficiaries").filter((row) => row.status === "active");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  const visit = (node: UiNode): void => {
    if (node.type === "form") for (const field of node.fields) {
      if (field.type !== "select") continue;
      const label = normalize(field.label);
      const rows = /origen|cuenta de debito/u.test(label) ? accounts
        : /beneficiario|destinatario|destino/u.test(label) ? beneficiaries : undefined;
      if (!rows) continue;
      const oldInitial = field.initialValue;
      for (const option of field.options) {
        const matches = rows.filter((row) => typeof row.id === "string" && typeof row.name === "string"
          && normalize(option.label).includes(normalize(row.name)));
        if (matches.length !== 1) continue;
        const originalValue = option.value;
        option.value = matches[0]!.id as string;
        if (oldInitial === originalValue) field.initialValue = option.value;
      }
    }
    const children = "children" in node ? node.children : node.type === "tabs" ? node.tabs.flatMap((tab) => tab.children) : [];
    children.forEach(visit);
  };
  visit(grounded.root);
  return grounded;
}
