import { z } from "zod";
import {
  GeminiApiClient,
  GeminiModelError,
  type FetchImplementation,
  type GeminiModelConfig,
} from "../../agent/model/gemini-api-client.js";
import {
  parseUiDocument,
  UiDataSourceSchema,
  UiDocumentValidationError,
  type UiDataSource,
  type UiDocument,
} from "../dsl/ui.schema.js";
import { type UiGenerationInput, type UiGenerator } from "./ui-generator.js";
import { createUiSystemPrompt } from "./ui-prompt.js";
import { MAX_AGENT_QUERY_LENGTH } from "../../agent/schemas/agent.schema.js";
import {
  validateUiSemantics,
  type SemanticUiIssue,
} from "./semantic-ui-validator.js";
import { createUiRecoveryPlan } from "./ui-recovery-planner.js";
import { createIntentAwareUiFallback } from "./intent-aware-ui-fallback.js";
import { groundPaymentFormOptions } from "./ground-payment-form-options.js";
import { logger } from "../../config/logger.js";
import type { FinancialExperienceScope } from "../../agent/security/financial-scope-policy.js";

const MAX_UI_CONTEXT_BYTES = 1_000_000;
const MAX_UI_OUTPUT_BYTES = 512_000;
const MAX_UI_GENERATION_ATTEMPTS = 3;
const UiGenerationInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_AGENT_QUERY_LENGTH),
  answer: z.string().trim().min(1).max(20_000),
  dataSources: z.array(UiDataSourceSchema).max(20),
}).strict();

export class GeminiUiGenerator implements UiGenerator {
  private readonly client: GeminiApiClient;

  constructor(
    config: GeminiModelConfig,
    fetchImplementation: FetchImplementation = fetch,
    private readonly experienceScope: FinancialExperienceScope = "full",
  ) {
    this.client = new GeminiApiClient(config, fetchImplementation);
  }

  async generate(
    rawInput: UiGenerationInput,
    signal?: AbortSignal,
  ): Promise<UiDocument> {
    const input = UiGenerationInputSchema.parse(rawInput);
    const serializedInput = JSON.stringify(input);
    if (Buffer.byteLength(serializedInput, "utf8") > MAX_UI_CONTEXT_BYTES) {
      throw new UiGenerationError("Los datos superan el límite para generar la interfaz");
    }

    let repairInstruction = "";
    let semanticIssues: SemanticUiIssue[] | undefined;
    for (let attempt = 1; attempt <= MAX_UI_GENERATION_ATTEMPTS; attempt += 1) {
      const systemPrompt = attempt === 1
        ? createUiSystemPrompt(this.experienceScope)
        : `${createUiSystemPrompt(this.experienceScope)}\n${repairInstruction}`;
      const content = await this.client.generateContent({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: serializedInput }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }, signal);
      const text = content.parts.flatMap((part) => part.text ?? []).join("").trim();
      if (Buffer.byteLength(text, "utf8") > MAX_UI_OUTPUT_BYTES) {
        throw new UiGenerationError("Gemini generó una interfaz demasiado grande");
      }

      try {
        const document = groundPaymentFormOptions(parseUiDocument(JSON.parse(text) as unknown, input.dataSources), input.dataSources);
        const semanticResult = validateUiSemantics(input.query, document, input.dataSources, {
          enforcePersonalBankingComposition: this.experienceScope === "personal_banking",
        });
        if (!semanticResult.success) throw new UiSemanticValidationError(semanticResult.issues);
        return document;
      } catch (error) {
        if (!isInvalidGeneratedUi(error)) throw error;
        logger.warn("UI generada rechazada antes de renderizar", {
          attempt,
          errorType: error.name,
          // Never log generated text, source values or the customer's query.
          issueCodes: error instanceof UiSemanticValidationError
            ? error.issues.map((issue) => issue.code)
            : error instanceof z.ZodError ? error.issues.map((issue) => issue.code) : [],
          schemaPaths: error instanceof z.ZodError
            ? error.issues.slice(0, 8).map((issue) => issue.path.join(".")) : [],
        });
        if (error instanceof UiSemanticValidationError) semanticIssues = error.issues;
        const fallback = createIntentAwareUiFallback(input.query, input.dataSources, this.experienceScope);
        if (fallback) {
          const result = validateUiSemantics(input.query, fallback, input.dataSources, {
            enforcePersonalBankingComposition: this.experienceScope === "personal_banking",
          });
          if (result.success) return fallback;
        }
        repairInstruction = createUiRepairInstruction(error, input.dataSources, attempt + 1);
        if (attempt === MAX_UI_GENERATION_ATTEMPTS) {
          if (semanticIssues) {
            throw new UiSemanticGenerationError(semanticIssues);
          }
          throw new UiGenerationError("Gemini generó una interfaz inválida");
        }
      }
    }

    throw new UiGenerationError("Gemini generó una interfaz inválida");
  }
}

function createUiRepairInstruction(
  error: z.ZodError | UiDocumentValidationError | UiSemanticValidationError | SyntaxError,
  dataSources: UiDataSource[],
  nextAttempt: number,
): string {
  if (error instanceof UiSemanticValidationError) {
    const validationDetails = error.issues.slice(0, 8).map((issue) =>
      `${issue.nodeId ? `${issue.nodeId}: ` : ""}${issue.message}`
    ).join("; ");
    return [
      "La UI anterior cumple el schema, pero no respeta requisitos explícitos del usuario.",
      `Violaciones semánticas: ${validationDetails}.`,
      createUiRecoveryPlan({ issues: error.issues, dataSources, attempt: nextAttempt }),
      "Genera nuevamente el documento completo y corrige todas las violaciones sin cambiar ni ignorar la petición del usuario.",
    ].join(" ");
  }
  const validationDetails = error instanceof z.ZodError
    ? error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "documento";
      return `${path}: ${issue.message}`;
    }).join("; ")
    : error.message;

  return [
    "La respuesta anterior no cumplió la UI DSL.",
    `Errores de validación: ${validationDetails}.`,
    "Genera nuevamente el documento completo, corrige exactamente esos errores y usa solamente rutas presentes en dataSources.",
    "Si una visualización compleja no puede cumplir el contrato, devuelve una composición más pequeña que conserve las restricciones explícitas del usuario.",
  ].join(" ");
}

function isInvalidGeneratedUi(
  error: unknown,
): error is z.ZodError | UiDocumentValidationError | UiSemanticValidationError | SyntaxError {
  return error instanceof z.ZodError
    || error instanceof UiDocumentValidationError
    || error instanceof UiSemanticValidationError
    || error instanceof SyntaxError;
}

class UiSemanticValidationError extends Error {
  constructor(readonly issues: SemanticUiIssue[]) {
    super("La UI no respeta los requisitos explícitos del usuario");
    this.name = "UiSemanticValidationError";
  }
}

export class UiGenerationError extends GeminiModelError {
  constructor(message: string) {
    super(message);
    this.name = "UiGenerationError";
  }
}

export class UiSemanticGenerationError extends UiGenerationError {
  constructor(readonly issues: SemanticUiIssue[]) {
    super("Gemini no pudo generar una interfaz que respetara la intención explícita");
    this.name = "UiSemanticGenerationError";
  }
}
