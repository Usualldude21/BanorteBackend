import { uiSpecificationSchema, type UIEvent } from "@banorte/contracts";
import { type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type AgentSessionSnapshot,
  type BeginSessionInput,
  type BeginSessionResult,
  type CompleteSessionInput,
  type SessionStore,
} from "../application/ports/session-store.js";
import { applySessionCompletion } from "../application/session-state.js";
import { FinancialCategorySchema } from "../domain/transaction.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";
import { readSessionUiSnapshot, isMissingSnapshotRpc } from "../integration/session-ui-snapshot.js";

const ResultCodeSchema = z.enum([
  "success",
  "session_busy",
  "session_forbidden",
  "session_not_found",
  "session_revision_conflict",
]);
const TurnSchema = z.object({
  user: z.string().max(10_000),
  assistant: z.string().max(2_000),
}).strict();
const InteractionValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(24),
  z.object({ start: z.string().max(10), end: z.string().max(10) }).strict(),
]);
const MoneySchema = z.object({
  amount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u),
  currency: z.literal("MXN"),
}).strict();
const ConstraintsSchema = z.object({
  revision: z.number().int().nonnegative(),
  savingsGoal: MoneySchema.optional(),
  horizonMonths: z.number().int().min(1).max(600).optional(),
  monthlyContribution: MoneySchema.optional(),
  protectedExpenseCategories: z.array(FinancialCategorySchema).max(20),
}).strict();
const BeginRowSchema = z.object({
  result_code: ResultCodeSchema,
  user_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  interface_revision: z.number().int().nonnegative().nullable(),
  data_revision: z.number().int().nonnegative().nullable(),
  data_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).max(100).nullable(),
  specification: uiSpecificationSchema.nullable(),
  turns: z.array(TurnSchema).max(6).nullable(),
  interaction_state: z.record(z.string().max(100), InteractionValueSchema).nullable(),
  financial_constraints: ConstraintsSchema.nullable(),
  pending_payment_intent_id: z.string().uuid().nullable(),
}).passthrough();
const MutationRowSchema = z.object({ result_code: ResultCodeSchema }).passthrough();

export class SupabaseSessionStore implements SessionStore {
  private readonly activeSnapshots = new Map<string, AgentSessionSnapshot>();

  constructor(private readonly client: SupabaseClient) {}

  async begin(input: BeginSessionInput): Promise<BeginSessionResult> {
    const row = await this.callSingle("begin_agent_session", {
      p_session_id: input.sessionId,
      p_correlation_id: input.correlationId,
      p_is_continuation: input.reference !== undefined,
      p_interface_revision: input.reference?.interfaceRevision ?? null,
      p_data_revision: input.reference?.dataRevision ?? null,
      p_data_keys: input.reference?.dataKeys ?? null,
    }, BeginRowSchema);

    if (row.result_code !== "success") return { success: false, code: row.result_code };
    if (
      row.user_id !== input.actorId
      || !row.session_id
      || row.interface_revision === null
      || row.data_revision === null
      || !row.data_keys
      || !row.turns
      || !row.interaction_state
      || !row.financial_constraints
    ) {
      throw new RepositoryError("Respuesta incompleta de begin_agent_session", "DATABASE_ERROR");
    }

    const state: AgentSessionSnapshot = {
      sessionId: row.session_id,
      interfaceRevision: row.interface_revision,
      dataRevision: row.data_revision,
      dataKeys: row.data_keys,
      ...(row.specification ? { specification: row.specification } : {}),
      turns: row.turns,
      interactionState: row.interaction_state as Record<string, UIEvent["event"]["value"]>,
      financialConstraints: {
        revision: row.financial_constraints.revision,
        protectedExpenseCategories: row.financial_constraints.protectedExpenseCategories,
        ...(row.financial_constraints.savingsGoal
          ? { savingsGoal: row.financial_constraints.savingsGoal }
          : {}),
        ...(row.financial_constraints.horizonMonths !== undefined
          ? { horizonMonths: row.financial_constraints.horizonMonths }
          : {}),
        ...(row.financial_constraints.monthlyContribution
          ? { monthlyContribution: row.financial_constraints.monthlyContribution }
          : {}),
      },
      ...(row.pending_payment_intent_id
        ? { pendingPaymentIntentId: row.pending_payment_intent_id }
        : {}),
    };
    try {
      const result = await readSessionUiSnapshot(this.client, input.sessionId, input.correlationId);
      if (result.code === "success" && result.snapshot
        && result.snapshot.interfaceRevision === state.interfaceRevision
        && result.snapshot.dataRevision === state.dataRevision) {
        state.dataRegistry = result.snapshot.data;
        state.invalidatedKeys = result.snapshot.invalidatedKeys;
      }
    } catch {
      // Existing session flow remains available; incomplete snapshots cannot be recovered.
    }
    this.activeSnapshots.set(activeKey(input.actorId, input.sessionId, input.correlationId), state);
    return { success: true, state, isContinuation: input.reference !== undefined };
  }

  async complete(input: CompleteSessionInput): Promise<void> {
    const key = activeKey(input.actorId, input.sessionId, input.correlationId);
    const current = this.activeSnapshots.get(key);
    if (!current) throw new RepositoryError("La sesión no está activa", "CONFLICT");
    const completed = applySessionCompletion(current, input);
    const parameters = {
      p_session_id: input.sessionId,
      p_correlation_id: input.correlationId,
      p_interface_revision: completed.interfaceRevision,
      p_data_revision: completed.dataRevision,
      p_data_keys: completed.dataKeys,
      p_specification: completed.specification ?? null,
      p_turns: completed.turns,
      p_interaction_state: completed.interactionState,
      p_financial_constraints: completed.financialConstraints,
      p_pending_payment_intent_id: completed.pendingPaymentIntentId ?? null,
    };
    const completeKeys = Object.keys(completed.dataRegistry ?? {}).sort();
    const hasSnapshot = completed.dataRegistry !== undefined
      && JSON.stringify(completeKeys) === JSON.stringify([...completed.dataKeys].sort());
    let row: z.infer<typeof MutationRowSchema>;
    if (hasSnapshot) {
      const result = await this.client.rpc("complete_agent_session_snapshot", {
        ...parameters, p_data_registry: completed.dataRegistry,
        p_invalidated_keys: completed.invalidatedKeys ?? [],
      });
      if (isMissingSnapshotRpc(result.error)) {
        row = await this.callSingle("complete_agent_session", parameters, MutationRowSchema);
      } else {
        if (result.error) throw mapearErrorSupabase(result.error, "rpc.complete_agent_session_snapshot");
        row = MutationRowSchema.parse(Array.isArray(result.data) ? result.data[0] : undefined);
      }
    } else row = await this.callSingle("complete_agent_session", parameters, MutationRowSchema);
    if (row.result_code !== "success") throw mutationError(row.result_code);
    this.activeSnapshots.delete(key);
  }

  async release(actorId: string, sessionId: string, correlationId: string): Promise<void> {
    const row = await this.callSingle("release_agent_session", {
      p_session_id: sessionId,
      p_correlation_id: correlationId,
    }, MutationRowSchema);
    this.activeSnapshots.delete(activeKey(actorId, sessionId, correlationId));
    if (row.result_code !== "success" && row.result_code !== "session_not_found") {
      throw mutationError(row.result_code);
    }
  }

  private async callSingle<T>(
    functionName: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { data } = await telemetry.observe(
      { component: "supabase", operation: "rpc", queryName: functionName },
      async () => {
        const result = await this.client.rpc(functionName, parameters);
        if (result.error) throw mapearErrorSupabase(result.error, "rpc." + functionName);
        return result;
      },
      (result) => ({ resultCount: Array.isArray(result.data) ? result.data.length : 0 }),
    );
    if (!Array.isArray(data) || data.length !== 1) {
      throw new RepositoryError("RPC de sesión sin resultado", "DATABASE_ERROR");
    }
    const parsed = schema.safeParse(data[0]);
    if (!parsed.success) {
      throw new RepositoryError("Respuesta inválida de " + functionName, "DATABASE_ERROR", parsed.error);
    }
    return parsed.data;
  }
}

function activeKey(actorId: string, sessionId: string, correlationId: string): string {
  return actorId + ":" + sessionId + ":" + correlationId;
}

function mutationError(code: z.infer<typeof ResultCodeSchema>): RepositoryError {
  if (code === "session_forbidden") {
    return new RepositoryError("La sesión no pertenece al usuario", "UNAUTHORIZED");
  }
  if (code === "session_not_found") {
    return new RepositoryError("La sesión no existe", "NOT_FOUND");
  }
  return new RepositoryError("Conflicto de estado en la sesión", "CONFLICT");
}
