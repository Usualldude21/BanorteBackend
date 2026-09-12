import {
  AgentToolCallSchema,
  type AgentToolDefinition,
  type AgentToolResult,
} from "../schemas/agent.schema.js";
import { type GeminiContent } from "../schemas/gemini.schema.js";
import {
  GeminiApiClient,
  type FetchImplementation,
  type GeminiModelConfig,
} from "./gemini-api-client.js";
import { type ModelGateway, type ModelSession, type ModelTurn } from "./model.js";

export { buildGenerateContentUrl, GeminiModelError } from "./gemini-api-client.js";

export class GeminiModel implements ModelGateway {
  private readonly client: GeminiApiClient;

  constructor(
    config: GeminiModelConfig,
    fetchImplementation: FetchImplementation = fetch,
  ) {
    this.client = new GeminiApiClient(config, fetchImplementation);
  }

  createSession(input: {
    query: string;
    systemInstruction: string;
    tools: AgentToolDefinition[];
  }): ModelSession {
    return new GeminiSession(this.client, input);
  }
}

class GeminiSession implements ModelSession {
  private readonly contents: unknown[];

  constructor(
    private readonly client: GeminiApiClient,
    private readonly input: {
      query: string;
      systemInstruction: string;
      tools: AgentToolDefinition[];
    },
  ) {
    this.contents = [{ role: "user", parts: [{ text: input.query }] }];
  }

  async next(
    toolResults: AgentToolResult[] = [],
    signal?: AbortSignal,
    feedback?: string,
  ): Promise<ModelTurn> {
    if (toolResults.length > 0) {
      this.contents.push(toFunctionResponseContent(toolResults));
    }
    if (feedback) {
      this.contents.push({ role: "user", parts: [{ text: feedback }] });
    }

    const content = await this.generateContent(signal);
    this.contents.push(content);

    return {
      text: content.parts.flatMap((part) => part.text ?? []).join("\n").trim(),
      toolCalls: content.parts.flatMap((part) => {
        if (!part.functionCall) return [];
        return [AgentToolCallSchema.parse({
          id: part.functionCall.id,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        })];
      }),
    };
  }

  private async generateContent(signal?: AbortSignal): Promise<GeminiContent> {
    return this.client.generateContent({
      systemInstruction: { parts: [{ text: this.input.systemInstruction }] },
      contents: this.contents,
      tools: [{
        functionDeclarations: this.input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: withoutSchemaDialect(tool.inputSchema),
        })),
      }],
    }, signal);
  }
}

function toFunctionResponseContent(toolResults: AgentToolResult[]) {
  return {
    role: "user",
    parts: toolResults.map(({ call, output }) => ({
      functionResponse: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name,
        response: { output },
      },
    })),
  };
}

function withoutSchemaDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _, ...parameters } = schema;
  return parameters;
}
