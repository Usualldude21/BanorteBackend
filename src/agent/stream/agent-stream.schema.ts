import { z } from "zod";
import { AgentResponseSchema } from "../schemas/agent.schema.js";
import { UiDataSourceSchema, UiDocumentSchema } from "../../ui/dsl/ui.schema.js";
import { UiPatchOperationSchema } from "../../ui/interaction/ui-patch.schema.js";

const StreamIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const SequenceSchema = z.number().int().positive();
const ToolNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream-started"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
  }).strict(),
  z.object({
    type: z.literal("status"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    stage: z.enum(["planning", "consulting-tools", "generating-ui", "rendering-ui"]),
    message: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("tool-started"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    toolName: ToolNameSchema,
  }).strict(),
  z.object({
    type: z.literal("tool-completed"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    source: UiDataSourceSchema,
  }).strict(),
  z.object({
    type: z.literal("ui-snapshot"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    ui: UiDocumentSchema,
    dataSources: z.array(UiDataSourceSchema).optional(),
  }).strict(),
  z.object({
    type: z.literal("ui-patch"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    operation: UiPatchOperationSchema,
  }).strict(),
  z.object({
    type: z.literal("error"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    code: z.enum(["invalid-request", "agent-error", "provider-error", "tool-error", "insufficient_funds", "ui-error", "semantic-ui-error", "financial-reasoning-error", "internal-error"]),
    message: z.string().trim().min(1).max(300),
    recoverable: z.boolean(),
    hasPartialData: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("cancelled"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    hasPartialData: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("completed"),
    streamId: StreamIdSchema,
    sequence: SequenceSchema,
    response: AgentResponseSchema,
  }).strict(),
]);

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

export function serializeAgentStreamEvent(event: AgentStreamEvent): string {
  return `${JSON.stringify(AgentStreamEventSchema.parse(event))}\n`;
}

export function parseAgentStreamEvent(serialized: string): AgentStreamEvent {
  return AgentStreamEventSchema.parse(JSON.parse(serialized) as unknown);
}
