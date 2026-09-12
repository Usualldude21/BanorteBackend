import { randomUUID } from "node:crypto";
import { type AgentStreamOptions } from "../orchestrator.js";
import { AgentStreamBuffer } from "./agent-stream-buffer.js";
import { type AgentStreamEvent } from "./agent-stream.schema.js";

interface AgentStreamSource {
  stream(
    query: string,
    options?: AgentStreamOptions,
  ): AsyncGenerator<AgentStreamEvent>;
}

export class AgentStreamSession {
  readonly streamId: string;
  private readonly controller = new AbortController();
  private readonly buffer: AgentStreamBuffer;
  private readonly iterator: AsyncGenerator<AgentStreamEvent>;
  private isReading = false;
  private pendingRead: Promise<IteratorResult<AgentStreamEvent>> | undefined;

  constructor(
    source: AgentStreamSource,
    query: string,
    buffer = new AgentStreamBuffer(),
    streamId = randomUUID(),
  ) {
    this.streamId = streamId;
    this.buffer = buffer;
    this.iterator = source.stream(query, {
      signal: this.controller.signal,
      streamId,
    });
  }

  async next(): Promise<IteratorResult<AgentStreamEvent>> {
    if (this.isReading) throw new AgentStreamReadInProgressError();
    this.isReading = true;
    this.pendingRead = this.iterator.next();
    try {
      const result = await this.pendingRead;
      if (!result.done) this.buffer.append(result.value);
      return result;
    } finally {
      this.isReading = false;
      this.pendingRead = undefined;
    }
  }

  replayAfter(sequence: number): AgentStreamEvent[] {
    return this.buffer.replayAfter(sequence);
  }

  cancel(): void {
    this.controller.abort();
  }

  async close(): Promise<void> {
    this.cancel();
    await this.pendingRead?.catch(() => undefined);
    await this.iterator.return(undefined);
  }
}

export class AgentStreamReadInProgressError extends Error {
  constructor() {
    super("Ya existe una lectura pendiente para este stream");
    this.name = "AgentStreamReadInProgressError";
  }
}
