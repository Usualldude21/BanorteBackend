import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AgentToolDefinitionSchema,
  JsonObjectSchema,
  type AgentToolCall,
  type AgentToolDefinition,
} from "../schemas/agent.schema.js";
import { validateToolOutput } from "./tool-output-validator.js";
import { readToolErrorDetails, type ToolErrorCode } from "../../application/tool-error-result.js";

const MAX_TOOL_OUTPUT_BYTES = 1_000_000;

const McpToolResultSchema = z.object({
  isError: z.boolean().optional(),
  _meta: z.record(z.unknown()).optional(),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
  }).passthrough()).min(1),
}).passthrough();

export interface FinancialToolClient {
  listTools(signal?: AbortSignal): Promise<AgentToolDefinition[]>;
  callTool(call: AgentToolCall, signal?: AbortSignal): Promise<unknown>;
}

export class FinancialMcpClient implements FinancialToolClient {
  private constructor(
    private readonly client: Client,
    private readonly server: McpServer,
    private readonly toolTimeoutMs: number,
  ) {}

  static async connect(
    server: McpServer,
    toolTimeoutMs = 12_000,
  ): Promise<FinancialMcpClient> {
    const client = new Client({ name: "financial-agent", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return new FinancialMcpClient(client, server, toolTimeoutMs);
  }

  async listTools(signal?: AbortSignal): Promise<AgentToolDefinition[]> {
    const response = await this.client.listTools(undefined, {
      ...(signal ? { signal } : {}),
    });
    return response.tools.map((tool) => AgentToolDefinitionSchema.parse({
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      inputSchema: JsonObjectSchema.parse(tool.inputSchema),
    }));
  }

  async callTool(call: AgentToolCall, signal?: AbortSignal): Promise<unknown> {
    let rawResult: unknown;
    try {
      rawResult = await this.client.callTool(
        { name: call.name, arguments: call.arguments },
        undefined,
        {
          timeout: this.toolTimeoutMs,
          maxTotalTimeout: this.toolTimeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
    } catch {
      throw new FinancialToolTransportError(call.name);
    }
    const result = McpToolResultSchema.parse(rawResult);
    const text = result.content.find((item) => item.type === "text")?.text;

    if (result.isError) {
      const details = readToolErrorDetails(result._meta);
      throw new FinancialToolError(call.name, details?.retryable ?? false, details?.code);
    }
    if (!text) {
      throw new FinancialToolError(call.name);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
      throw new FinancialToolError(call.name);
    }

    let output: unknown;
    try {
      output = JSON.parse(text) as unknown;
    } catch {
      throw new FinancialToolError(call.name);
    }
    return validateToolOutput(call.name, output);
  }

  async close(): Promise<void> {
    await Promise.all([this.client.close(), this.server.close()]);
  }
}

export class FinancialToolTransportError extends Error {
  constructor(toolName: string) {
    super(`No fue posible comunicarse con la herramienta ${toolName}`);
    this.name = "FinancialToolTransportError";
  }
}

export class FinancialToolError extends Error {
  constructor(
    toolName: string,
    readonly retryable = false,
    readonly code?: ToolErrorCode,
  ) {
    super(`La herramienta ${toolName} no pudo entregar datos válidos`);
    this.name = "FinancialToolError";
  }
}
