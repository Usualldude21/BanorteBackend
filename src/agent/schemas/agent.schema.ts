import { z } from "zod";
import { UiDataSourcesSchema, UiDocumentSchema } from "../../ui/dsl/ui.schema.js";

export const MAX_AGENT_QUERY_LENGTH = 12_000;
export const AgentQuerySchema = z.string().trim().min(1).max(MAX_AGENT_QUERY_LENGTH);

export const JsonObjectSchema = z.record(z.unknown());

export const AgentToolDefinitionSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  description: z.string().min(1),
  inputSchema: JsonObjectSchema,
}).strict();

export const AgentToolCallSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  arguments: JsonObjectSchema,
}).strict();

export const AgentToolResultSchema = z.object({
  call: AgentToolCallSchema,
  output: z.unknown(),
}).strict();

export const AgentResponseSchema = z.object({
  answer: z.string().min(1),
  toolsUsed: z.array(z.string()).max(20),
  ui: UiDocumentSchema,
  dataSources: UiDataSourcesSchema,
}).strict();

export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
