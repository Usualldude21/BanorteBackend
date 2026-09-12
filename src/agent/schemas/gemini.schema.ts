import { z } from "zod";
import { JsonObjectSchema } from "./agent.schema.js";

export const GeminiFunctionCallSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  args: JsonObjectSchema.default({}),
}).passthrough();

export const GeminiPartSchema = z.object({
  text: z.string().optional(),
  functionCall: GeminiFunctionCallSchema.optional(),
}).passthrough();

export const GeminiContentSchema = z.object({
  role: z.string().optional(),
  parts: z.array(GeminiPartSchema).min(1),
}).passthrough();

export const GeminiUsageMetadataSchema = z.object({
  promptTokenCount: z.number().int().nonnegative().optional(),
  candidatesTokenCount: z.number().int().nonnegative().optional(),
  totalTokenCount: z.number().int().nonnegative().optional(),
  cachedContentTokenCount: z.number().int().nonnegative().optional(),
  thoughtsTokenCount: z.number().int().nonnegative().optional(),
}).passthrough();

export const GeminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: GeminiContentSchema,
  }).passthrough()).min(1),
  usageMetadata: GeminiUsageMetadataSchema.optional(),
}).passthrough();

export type GeminiContent = z.infer<typeof GeminiContentSchema>;
export type GeminiResponse = z.infer<typeof GeminiResponseSchema>;
