import {
  type SessionReference,
  type UIEvent,
  type UISpecification,
  type DataRegistryValue,
} from "@banorte/contracts";
import { type FinancialConstraints } from "../../domain/financial-constraints.js";

export interface SessionTurn {
  user: string;
  assistant: string;
}

export interface AgentSessionSnapshot extends SessionReference {
  dataRegistry?: DataRegistryValue;
  invalidatedKeys?: readonly string[];
  sessionId: string;
  specification?: UISpecification;
  turns: readonly SessionTurn[];
  interactionState: Readonly<Record<string, UIEvent["event"]["value"]>>;
  financialConstraints: FinancialConstraints;
  pendingPaymentIntentId?: string;
}

export interface BeginSessionInput {
  actorId: string;
  sessionId: string;
  correlationId: string;
  reference?: SessionReference;
}

export interface CompleteSessionInput extends SessionReference {
  dataRegistry?: DataRegistryValue;
  invalidatedKeys?: readonly string[];
  actorId: string;
  sessionId: string;
  correlationId: string;
  specification?: UISpecification;
  prompt?: string;
  answer: string;
  interaction?: UIEvent["event"];
  pendingPaymentIntentId?: string | null;
}

export type BeginSessionResult =
  | { success: true; state: AgentSessionSnapshot; isContinuation: boolean }
  | {
    success: false;
    code:
      | "session_busy"
      | "session_forbidden"
      | "session_not_found"
      | "session_revision_conflict";
  };

export interface SessionStore {
  begin(input: BeginSessionInput): Promise<BeginSessionResult>;
  complete(input: CompleteSessionInput): Promise<void>;
  release(actorId: string, sessionId: string, correlationId: string): Promise<void>;
}
