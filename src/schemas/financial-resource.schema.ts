import { z } from "zod";
import { AccountTypeSchema } from "../domain/account.js";
import { FinancialCategorySchema, TransactionTypeSchema } from "../domain/transaction.js";

export const FinancialResourceUriSchema = z.enum([
  "financial://categories",
  "financial://account-types",
  "financial://transaction-types",
  "financial://metric-definitions",
]);

const ResourceVersionSchema = z.literal("1.0");

const AccountTypeEntrySchema = z.object({
  value: AccountTypeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
}).strict();

const TransactionTypeEntrySchema = z.object({
  value: TransactionTypeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
}).strict();

const CategoryEntrySchema = z.object({
  value: FinancialCategorySchema,
  label: z.string().min(1),
  description: z.string().min(1),
}).strict();

const MetricDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  calculation: z.string().min(1),
  unit: z.enum(["currency", "percentage", "count"]),
  nullable: z.boolean(),
  sourceTools: z.array(z.enum([
    "get_financial_summary",
    "get_spending_by_category",
    "get_cashflow",
  ])).min(1),
}).strict();

export const AccountTypesResourceSchema = z.object({
  schemaVersion: ResourceVersionSchema,
  kind: z.literal("account-types"),
  entries: z.array(AccountTypeEntrySchema).length(AccountTypeSchema.options.length),
}).strict();

export const TransactionTypesResourceSchema = z.object({
  schemaVersion: ResourceVersionSchema,
  kind: z.literal("transaction-types"),
  entries: z.array(TransactionTypeEntrySchema).length(TransactionTypeSchema.options.length),
}).strict();

export const CategoriesResourceSchema = z.object({
  schemaVersion: ResourceVersionSchema,
  kind: z.literal("categories"),
  model: z.literal("controlled"),
  maximumLength: z.literal(100),
  defaultWhenOmitted: z.literal("other"),
  systemEntries: z.array(CategoryEntrySchema).length(FinancialCategorySchema.options.length),
}).strict();

export const MetricDefinitionsResourceSchema = z.object({
  schemaVersion: ResourceVersionSchema,
  kind: z.literal("metric-definitions"),
  currencyHandling: z.literal("separate-series"),
  definitions: z.array(MetricDefinitionSchema).min(1),
}).strict();

export const FinancialResourceSchema = z.discriminatedUnion("kind", [
  AccountTypesResourceSchema,
  TransactionTypesResourceSchema,
  CategoriesResourceSchema,
  MetricDefinitionsResourceSchema,
]);

export type FinancialResourceUri = z.infer<typeof FinancialResourceUriSchema>;
export type FinancialResource = z.infer<typeof FinancialResourceSchema>;
