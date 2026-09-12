import { z } from "zod";
import {
  CashflowOutputSchema,
  FinancialSummaryOutputSchema,
  SpendingByCategoryOutputSchema,
} from "../../schemas/analytics.schema.js";
import { ComparePeriodsOutputSchema } from "../../schemas/compare-periods.schema.js";
import { DetectAnomaliesOutputSchema } from "../../schemas/detect-anomalies.schema.js";
import { GetAccountsOutputSchema } from "../../schemas/get-accounts.schema.js";
import { GetTransactionsOutputSchema } from "../../schemas/get-transactions.schema.js";
import { EvaluateFinancialHealthOutputSchema } from "../../schemas/financial-health.schema.js";
import { PingOutputSchema } from "../../schemas/ping.schema.js";
import {
  CancelPaymentIntentOutputSchema,
  ConfirmPaymentOutputSchema,
  CreatePaymentIntentOutputSchema,
  GetPaymentStatusOutputSchema,
} from "../../schemas/payment.schema.js";
import { GetBeneficiariesOutputSchema } from "../../schemas/beneficiary.schema.js";
import {
  SimulateLoanOutputSchema,
  SimulateSavingsOutputSchema,
} from "../../schemas/simulation.schema.js";

const TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  ping: PingOutputSchema,
  get_accounts: GetAccountsOutputSchema,
  get_transactions: GetTransactionsOutputSchema,
  get_financial_summary: FinancialSummaryOutputSchema,
  get_spending_by_category: SpendingByCategoryOutputSchema,
  get_cashflow: CashflowOutputSchema,
  compare_periods: ComparePeriodsOutputSchema,
  detect_transaction_anomalies: DetectAnomaliesOutputSchema,
  evaluate_financial_health: EvaluateFinancialHealthOutputSchema,
  get_beneficiaries: GetBeneficiariesOutputSchema,
  create_payment_intent: CreatePaymentIntentOutputSchema,
  confirm_payment: ConfirmPaymentOutputSchema,
  get_payment_status: GetPaymentStatusOutputSchema,
  cancel_payment_intent: CancelPaymentIntentOutputSchema,
  simulate_loan: SimulateLoanOutputSchema,
  simulate_savings: SimulateSavingsOutputSchema,
};

export function validateToolOutput(toolName: string, output: unknown): unknown {
  const schema = TOOL_OUTPUT_SCHEMAS[toolName];
  if (!schema) throw new ToolOutputValidationError(toolName);

  const result = schema.safeParse(output);
  if (!result.success) throw new ToolOutputValidationError(toolName);
  return result.data;
}

export class ToolOutputValidationError extends Error {
  constructor(toolName: string) {
    super(`La salida de ${toolName} no cumple su contrato`);
    this.name = "ToolOutputValidationError";
  }
}
