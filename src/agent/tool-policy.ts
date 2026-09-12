import { type AgentToolCall, type AgentToolDefinition } from "./schemas/agent.schema.js";

export const READ_FINANCIAL_TOOL_NAMES = [
  "get_accounts",
  "get_transactions",
  "get_financial_summary",
  "get_spending_by_category",
  "get_cashflow",
  "compare_periods",
  "detect_transaction_anomalies",
  "evaluate_financial_health",
  "get_beneficiaries",
  "get_payment_status",
  "simulate_loan",
  "simulate_savings",
] as const;

export const WRITE_FINANCIAL_TOOL_NAMES = [
  "create_payment_intent",
  "cancel_payment_intent",
] as const;

export const CRITICAL_WRITE_FINANCIAL_TOOL_NAMES = [
  "confirm_payment",
] as const;

export const ALLOWED_FINANCIAL_TOOL_NAMES = [
  ...READ_FINANCIAL_TOOL_NAMES,
  ...WRITE_FINANCIAL_TOOL_NAMES,
  ...CRITICAL_WRITE_FINANCIAL_TOOL_NAMES,
] as const;

export type FinancialToolRisk = "read" | "write" | "critical-write";

const ALLOWED_TOOLS = new Set<string>(ALLOWED_FINANCIAL_TOOL_NAMES);
const READ_TOOLS = new Set<string>(READ_FINANCIAL_TOOL_NAMES);
const WRITE_TOOLS = new Set<string>(WRITE_FINANCIAL_TOOL_NAMES);
const CRITICAL_WRITE_TOOLS = new Set<string>(CRITICAL_WRITE_FINANCIAL_TOOL_NAMES);

export function selectAllowedTools(
  definitions: AgentToolDefinition[],
  permittedToolNames: readonly string[] = ALLOWED_FINANCIAL_TOOL_NAMES,
): AgentToolDefinition[] {
  const permittedTools = new Set(permittedToolNames);
  return definitions.filter((tool) => (
    ALLOWED_TOOLS.has(tool.name) && permittedTools.has(tool.name)
  ));
}

export function isAllowedTool(toolName: string): boolean {
  return ALLOWED_TOOLS.has(toolName);
}

export function financialToolRisk(toolName: string): FinancialToolRisk | undefined {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (CRITICAL_WRITE_TOOLS.has(toolName)) return "critical-write";
  return undefined;
}

export function toolCallFingerprint(call: AgentToolCall): string {
  return JSON.stringify([call.name, sortObject(call.arguments)]);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)]),
  );
}
