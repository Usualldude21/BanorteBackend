import { AgentStreamEventSchema, type AgentStreamEvent } from "../../agent/stream/agent-stream.schema.js";
import {
  parseUiDocument,
  type UiDataSource,
  type UiDocument,
} from "../dsl/ui.schema.js";
import { applyUiPatch } from "../interaction/ui-patch.schema.js";

export type UiStreamPhase = "idle" | "loading" | "partial" | "complete" | "error" | "cancelled";

export interface UiStreamState {
  streamId: string | null;
  lastSequence: number;
  phase: UiStreamPhase;
  message: string | null;
  ui: UiDocument | null;
  dataSources: UiDataSource[];
  error: { code: string; recoverable: boolean } | null;
}

export function createInitialUiStreamState(): UiStreamState {
  return {
    streamId: null,
    lastSequence: 0,
    phase: "idle",
    message: null,
    ui: null,
    dataSources: [],
    error: null,
  };
}

export function reduceUiStreamEvent(
  currentState: UiStreamState,
  rawEvent: AgentStreamEvent,
): UiStreamState {
  const event = AgentStreamEventSchema.parse(rawEvent);
  validateEventOrder(currentState, event);
  const state = {
    ...currentState,
    streamId: event.streamId,
    lastSequence: event.sequence,
  };

  switch (event.type) {
    case "stream-started":
      return { ...createInitialUiStreamState(), ...state, phase: "loading" };
    case "status":
      return { ...state, phase: state.ui ? "partial" : "loading", message: event.message };
    case "tool-started":
      return { ...state, phase: "loading", message: `Consultando ${event.toolName}` };
    case "tool-completed":
      return {
        ...state,
        phase: "loading",
        message: `Datos de ${event.source.toolName} disponibles`,
        dataSources: appendSource(state.dataSources, event.source),
      };
    case "ui-snapshot":
      return {
        ...state,
        phase: "partial",
        message: "Actualizando la interfaz",
        ui: parseUiDocument(event.ui, state.dataSources),
      };
    case "ui-patch": {
      if (!state.ui) throw new UiStreamSequenceError("El parche llegó antes del primer snapshot");
      const patched = applyUiPatch(state.ui, state.dataSources, {
        version: "1.0",
        operations: [event.operation],
        dataSources: state.dataSources,
      });
      return {
        ...state,
        phase: "partial",
        message: "Actualizando la interfaz",
        ui: patched.document,
        dataSources: patched.dataSources,
      };
    }
    case "completed":
      return {
        ...state,
        phase: "complete",
        message: null,
        ui: parseUiDocument(event.response.ui, event.response.dataSources),
        dataSources: event.response.dataSources,
        error: null,
      };
    case "error":
      return {
        ...state,
        phase: "error",
        message: event.message,
        error: { code: event.code, recoverable: event.recoverable },
      };
    case "cancelled":
      return {
        ...state,
        phase: "cancelled",
        message: "La generación fue cancelada",
      };
    default:
      return assertNever(event);
  }
}

function validateEventOrder(state: UiStreamState, event: AgentStreamEvent): void {
  if (state.streamId === null) {
    if (event.type !== "stream-started" || event.sequence !== 1) {
      throw new UiStreamSequenceError("El primer evento del stream es inválido");
    }
    return;
  }
  if (event.streamId !== state.streamId) {
    throw new UiStreamSequenceError("El evento pertenece a otro stream");
  }
  if (event.sequence !== state.lastSequence + 1) {
    throw new UiStreamSequenceError("La secuencia del stream no es continua");
  }
}

function appendSource(
  sources: UiDataSource[],
  source: UiDataSource,
): UiDataSource[] {
  if (sources.some((item) => item.id === source.id)) {
    throw new UiStreamSequenceError("El stream repitió una fuente de datos");
  }
  return [...sources, source];
}

function assertNever(value: never): never {
  throw new Error(`Evento de stream no soportado: ${String(value)}`);
}

export class UiStreamSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiStreamSequenceError";
  }
}
