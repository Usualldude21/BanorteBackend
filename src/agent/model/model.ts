import {
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolResult,
} from "../schemas/agent.schema.js";

export interface ModelTurn {
  text: string;
  toolCalls: AgentToolCall[];
}

export interface ModelSession {
  next(
    toolResults?: AgentToolResult[],
    signal?: AbortSignal,
    feedback?: string,
  ): Promise<ModelTurn>;
}

export interface ModelGateway {
  createSession(input: {
    query: string;
    systemInstruction: string;
    tools: AgentToolDefinition[];
  }): ModelSession;
}
