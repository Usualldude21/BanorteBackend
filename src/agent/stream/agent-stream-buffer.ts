import {
  AgentStreamEventSchema,
  serializeAgentStreamEvent,
  type AgentStreamEvent,
} from "./agent-stream.schema.js";

const DEFAULT_MAX_EVENTS = 50;
const DEFAULT_MAX_BYTES = 25_000_000;

export class AgentStreamBuffer {
  private readonly events: AgentStreamEvent[] = [];
  private byteSize = 0;
  private streamId?: string;

  constructor(
    private readonly maxEvents = DEFAULT_MAX_EVENTS,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 500) {
      throw new RangeError("maxEvents debe estar entre 1 y 500");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 1_000 || maxBytes > 50_000_000) {
      throw new RangeError("maxBytes debe estar entre 1000 y 50000000");
    }
  }

  append(rawEvent: AgentStreamEvent): void {
    const event = AgentStreamEventSchema.parse(rawEvent);
    this.validateOrder(event);
    const eventBytes = Buffer.byteLength(serializeAgentStreamEvent(event), "utf8");
    if (eventBytes > this.maxBytes) throw new StreamEventTooLargeError();

    this.events.push(event);
    this.byteSize += eventBytes;
    this.streamId = event.streamId;
    this.discardOldestEvents();
  }

  replayAfter(sequence: number): AgentStreamEvent[] {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new RangeError("sequence debe ser un entero mayor o igual a cero");
    }
    const earliestSequence = this.events[0]?.sequence;
    if (earliestSequence !== undefined && sequence < earliestSequence - 1) {
      throw new StreamReplayUnavailableError();
    }
    return this.events.filter((event) => event.sequence > sequence);
  }

  private validateOrder(event: AgentStreamEvent): void {
    if (this.streamId && event.streamId !== this.streamId) {
      throw new StreamSequenceError("El buffer no puede mezclar streams");
    }
    const previousSequence = this.events.at(-1)?.sequence;
    if (previousSequence !== undefined && event.sequence !== previousSequence + 1) {
      throw new StreamSequenceError("La secuencia del stream no es continua");
    }
  }

  private discardOldestEvents(): void {
    while (this.events.length > this.maxEvents || this.byteSize > this.maxBytes) {
      const removed = this.events.shift();
      if (!removed) return;
      this.byteSize -= Buffer.byteLength(serializeAgentStreamEvent(removed), "utf8");
    }
  }
}

export class StreamReplayUnavailableError extends Error {
  constructor() {
    super("Los eventos solicitados ya no están disponibles");
    this.name = "StreamReplayUnavailableError";
  }
}

export class StreamSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamSequenceError";
  }
}

export class StreamEventTooLargeError extends Error {
  constructor() {
    super("El evento supera el tamaño permitido del buffer");
    this.name = "StreamEventTooLargeError";
  }
}
