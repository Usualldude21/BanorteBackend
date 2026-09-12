import { z } from "zod";
import { type RepositoryErrorCode } from "../errors/repository.error.js";

const TOOL_ERROR_META_KEY = "banorte/error";

const ToolErrorDetailsSchema = z.object({
  code: z.enum([
    "temporarily_unavailable",
    "rate_limited",
    "unauthorized",
    "not_found",
    "invalid_input",
    "insufficient_funds",
    "internal",
  ]),
  retryable: z.boolean(),
});

export type ToolErrorCode = z.infer<typeof ToolErrorDetailsSchema>["code"];

export function createToolErrorResult(
  message: string,
  code: ToolErrorCode,
  retryable = false,
) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
    _meta: {
      [TOOL_ERROR_META_KEY]: { code, retryable },
    },
  };
}

export function readToolErrorDetails(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[TOOL_ERROR_META_KEY];
  const parsed = ToolErrorDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function classifyRepositoryError(code: RepositoryErrorCode) {
  switch (code) {
    case "DATABASE_ERROR":
      return { code: "temporarily_unavailable" as const, retryable: true };
    case "UNAUTHORIZED":
      return { code: "unauthorized" as const, retryable: false };
    case "NOT_FOUND":
      return { code: "not_found" as const, retryable: false };
    case "INVALID_INPUT":
    case "CONFLICT":
      return { code: "invalid_input" as const, retryable: false };
    case "INSUFFICIENT_FUNDS":
      return { code: "insufficient_funds" as const, retryable: false };
  }
}
