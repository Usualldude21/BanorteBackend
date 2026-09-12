import {
  agentStatusSchema,
  dataPatchSchema,
  errorPayloadSchema,
  textAgentStreamEventSchema,
  type TextAgentRequest,
  type TextAgentStreamEvent,
  type UISpecification,
} from "@banorte/contracts";
import { createAuthenticatedSupabaseSession } from "../config/supabase.js";
import { createAgentRuntime, type AgentRuntime, type SessionFactory } from "../agent/cli/agent-runtime.js";
import { UiDocumentSchema, type UiDataSource, type UiDocument } from "../ui/dsl/ui.schema.js";
import { type UiGenerator } from "../ui/generation/ui-generator.js";
import { applyUiPatch } from "../ui/interaction/ui-patch.schema.js";
import {
  adaptUiDataSource,
  adaptUiPayload,
  type SharedUiPayload,
} from "./shared-contract-adapter.js";
import { createProvisionalUiPayload, createSharedUiPatch, createSharedUiPatches } from "./shared-ui-stream.js";
import { createUiEventQuery, reconcileUiEventControl, SharedUiEventValidationError } from "./shared-ui-event.js";
import { logger } from "../config/logger.js";
import { createFollowUpQuery } from "./agent-session-store.js";
import { type SessionStore } from "../application/ports/session-store.js";
import { SupabaseSessionStore } from "../repositories/supabase-session.repository.js";
import { allowsProvisionalCollectionPreview } from "../ui/generation/semantic-ui-validator.js";
import { type PaymentConfirmationGrant } from "../application/ports/payment-confirmation-authorization.js";
import { type PaymentWriteGrant } from "../application/ports/payment-write-authorization.js";
import { paymentWritePermissionsForQuery } from "../agent/payment-write-policy.js";
import { paymentReviewPermission } from "./payment-review-permission.js";

interface TextAgentServiceDependencies {
  createRuntime?: (
    sessionFactory: SessionFactory,
    responseMode: TextAgentRequest["responseMode"],
    paymentConfirmationGrant?: PaymentConfirmationGrant,
    paymentWriteGrant?: PaymentWriteGrant,
  ) => Promise<AgentRuntime>;
  sessionFactory?: SessionFactory;
  sessionStore?: SessionStore;
  now?: () => number;
}

export function createTextAgentService(dependencies: TextAgentServiceDependencies = {}) {
  const defaultSessionFactory = dependencies.sessionFactory ?? createAuthenticatedSupabaseSession;
  const createRuntime = dependencies.createRuntime ?? createRuntimeForMode;
  const now = dependencies.now ?? (() => performance.now());

  return async function* streamTextAgent(
    request: TextAgentRequest,
    signal?: AbortSignal,
    authenticatedSessionFactory?: SessionFactory,
  ): AsyncGenerator<TextAgentStreamEvent> {
    const sessionFactory = authenticatedSessionFactory ?? defaultSessionFactory;
    let sequence = 0;
    const event = <T extends Omit<TextAgentStreamEvent, "version" | "sessionId" | "correlationId" | "sequence">>(
      payload: T,
    ): TextAgentStreamEvent => textAgentStreamEventSchema.parse({
      version: "1",
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      sequence: sequence += 1,
      ...payload,
    });
    const startedAt = now();

    yield event({ type: "started" });
    if (request.provider !== "google") {
      yield event({
        type: "error",
        error: errorPayloadSchema.parse({
          version: "1",
          code: "provider_not_supported",
          message: "El proveedor solicitado no está disponible",
          recoverable: false,
          hasPartialData: false,
          correlationId: request.correlationId,
        }),
      });
      return;
    }

    const isUiInteraction = "uiEvent" in request;
    let authenticatedSession: Awaited<ReturnType<SessionFactory>> | undefined;
    const requestSessionFactory: SessionFactory = async () => {
      authenticatedSession ??= await sessionFactory();
      return authenticatedSession;
    };
    let actorId: string;
    let sessionStore: SessionStore;
    try {
      const session = await requestSessionFactory();
      actorId = session.user.id;
      sessionStore = dependencies.sessionStore ?? new SupabaseSessionStore(session.client);
    } catch {
      yield event({
        type: "error",
        error: errorPayloadSchema.parse({
          version: "1",
          code: "authentication_required",
          message: "La sesión autenticada no está disponible",
          recoverable: true,
          hasPartialData: false,
          correlationId: request.correlationId,
        }),
      });
      return;
    }
    const sessionReference = isUiInteraction
      ? {
          interfaceRevision: request.uiEvent.interfaceRevision,
          dataRevision: request.uiEvent.dataRevision,
          dataKeys: request.uiEvent.dataKeys,
        }
      : request.sessionState;
    const session = await sessionStore.begin({
      actorId,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      ...(sessionReference ? { reference: sessionReference } : {}),
    });
    if (!session.success) {
      yield event({
        type: "error",
        error: errorPayloadSchema.parse({
          version: "1",
          code: session.code,
          message: sessionErrorMessage(session.code),
          recoverable: true,
          hasPartialData: false,
          correlationId: request.correlationId,
        }),
      });
      return;
    }

    let agentQuery: string;
    logger.info("Continuidad de sesión Agent", {
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      isContinuation: session.isContinuation,
      interfaceRevision: session.state.interfaceRevision,
      dataRevision: session.state.dataRevision,
    });
    let paymentConfirmationIntentId: string | undefined;
    let paymentConfirmationGrant: PaymentConfirmationGrant | undefined;
    let paymentWriteGrant: PaymentWriteGrant | undefined;
    try {
      if (isUiInteraction) {
        if (
          request.responseMode !== "complete-ui"
          || request.uiEvent.sessionId !== request.sessionId
          || request.uiEvent.correlationId !== request.correlationId
        ) {
          throw new SharedUiEventValidationError("La interacción no coincide con la solicitud");
        }
        const specification = session.state.specification;
        if (!specification) throw new SharedUiEventValidationError("La sesión no contiene una interfaz activa");
        if (request.uiEvent.event.name === "payment.confirmed") {
          if (!session.state.pendingPaymentIntentId) {
            throw new SharedUiEventValidationError("La sesión no contiene un pago pendiente");
          }
          paymentConfirmationIntentId = session.state.pendingPaymentIntentId;
        }
        agentQuery = createUiEventQuery(request.uiEvent, specification, session.state.turns.at(-1)?.user);
        const reviewPermission = paymentReviewPermission(request.uiEvent, specification,
          session.state.turns.at(-1)?.user ?? "", session.state.pendingPaymentIntentId);
        if (reviewPermission) {
          paymentWriteGrant = { actorId, sessionId: request.sessionId, correlationId: request.correlationId,
            interfaceRevision: request.uiEvent.interfaceRevision, dataRevision: request.uiEvent.dataRevision,
            permissions: [reviewPermission] };
          agentQuery += ` Prepara únicamente la intención para revisión con estos parámetros validados por el servidor: ${JSON.stringify(reviewPermission.payment)}. Después consulta get_accounts y get_beneficiaries para vincular a la revisión los nombres verificados de origen y destino. Muestra ambos, monto, concepto, comisión, saldo estimado y vencimiento antes de ofrecer confirmación. No confirmes ni ejecutes el pago.`;
        }
        if (paymentConfirmationIntentId) {
          agentQuery += ` La persona confirmó explícitamente el intent ${paymentConfirmationIntentId}. Invoca confirm_payment con paymentIntentId exactamente igual a ese UUID; no prepares otro pago. Después consulta get_accounts y get_transactions para mostrar comprobante y saldo actualizado.`;
          paymentConfirmationGrant = {
            actorId,
            paymentIntentId: paymentConfirmationIntentId,
            sessionId: request.sessionId,
            correlationId: request.correlationId,
            interfaceRevision: request.uiEvent.interfaceRevision,
            dataRevision: request.uiEvent.dataRevision,
          };
        }
        logger.info("UIEvent validado para el Agent Runtime", {
          correlationId: request.correlationId,
          eventName: request.uiEvent.event.name,
          sourceId: request.uiEvent.event.sourceId,
          interfaceRevision: request.uiEvent.interfaceRevision,
        });
      } else {
        const permissions = paymentWritePermissionsForQuery(
          request.query,
          session.state.pendingPaymentIntentId ?? undefined,
        );
        if (permissions.length > 0) {
          paymentWriteGrant = {
            actorId,
            sessionId: request.sessionId,
            correlationId: request.correlationId,
            interfaceRevision: session.state.interfaceRevision,
            dataRevision: session.state.dataRevision,
            permissions,
          };
        }
        agentQuery = session.isContinuation
          ? createFollowUpQuery(session.state, request.query)
          : request.query;
      }
    } catch (error) {
      if (!(error instanceof SharedUiEventValidationError)) throw error;
      yield event({
        type: "error",
        error: errorPayloadSchema.parse({
          version: "1",
          code: "ui_event_invalid",
          message: "La interacción de interfaz no es válida",
          recoverable: true,
          hasPartialData: false,
          correlationId: request.correlationId,
        }),
      });
      await sessionStore.release(actorId, request.sessionId, request.correlationId);
      return;
    }

    let runtime: AgentRuntime | undefined;
    let hasPartialData = false;
    let isSessionCompleted = false;
    let firstUiAt: number | undefined;
    let agentLatencyMs: number | undefined;
    let dataReadyAt: number | undefined;
    let mcpStartedAt: number | undefined;
    let mcpLatencyMs = 0;
    let uiPlanningStartedAt: number | undefined;
    let uiPlanningLatencyMs = 0;
    let currentUi: UiDocument | undefined;
    let currentSpecification: UISpecification | undefined = session.state.specification;
    let interfaceRevision = session.state.interfaceRevision;
    let dataRevision = session.state.dataRevision;
    const initialDataKeys = new Set(session.state.dataKeys);
    const sourceOffset = [...initialDataKeys].reduce((highest, key) => {
      const match = /^source_(\d+)$/u.exec(key);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const knownDataKeys = new Set(initialDataKeys);
    const snapshotData = structuredClone(session.state.dataRegistry ?? {});
    const invalidatedKeys = new Set(session.state.invalidatedKeys ?? []);
    const refreshedDataKeys = new Set<string>();
    const dataSources: UiDataSource[] = [];
    const adaptPayload = (
      ui: UiDocument,
      sources: UiDataSource[],
    ): SharedUiPayload => {
      const payload = adaptUiPayload(ui, sources, dataRevision, sourceOffset);
      return isUiInteraction
        ? { ...payload, specification: reconcileUiEventControl(payload.specification, request.uiEvent.event, session.state.specification) }
        : payload;
    };
    const createDataPatchForSource = (source: UiDataSource) => {
      const adaptedSource = adaptUiDataSource(source, sourceOffset);
      const dataPatch = dataPatchSchema.parse({
        version: "1",
        baseRevision: dataRevision,
        revision: dataRevision + 1,
        op: knownDataKeys.has(adaptedSource.key) ? "update" : "add",
        key: adaptedSource.key,
        value: adaptedSource.value,
      });
      dataRevision = dataPatch.revision;
      knownDataKeys.add(dataPatch.key);
      if ("value" in dataPatch) snapshotData[dataPatch.key] = dataPatch.value;
      invalidatedKeys.delete(dataPatch.key);
      refreshedDataKeys.add(dataPatch.key);
      logDataPatch(request.correlationId, dataPatch);
      return dataPatch;
    };
    const registerInlinePayloadData = (payload: SharedUiPayload) => {
      Object.assign(snapshotData, payload.dataRegistry.data);
      for (const key of Object.keys(payload.dataRegistry.data)) {
        knownDataKeys.add(key);
        invalidatedKeys.delete(key);
        refreshedDataKeys.add(key);
      }
    };
    const createMissingPayloadDataPatches = (payload: SharedUiPayload) => {
      const patches = [];
      for (const [key, value] of Object.entries(payload.dataRegistry.data)) {
        if (knownDataKeys.has(key)) continue;
        const dataPatch = dataPatchSchema.parse({
          version: "1",
          baseRevision: dataRevision,
          revision: dataRevision + 1,
          op: "add",
          key,
          value,
        });
        dataRevision = dataPatch.revision;
        knownDataKeys.add(key);
        snapshotData[key] = value;
        invalidatedKeys.delete(key);
        refreshedDataKeys.add(key);
        logDataPatch(request.correlationId, dataPatch);
        patches.push(dataPatch);
      }
      return patches;
    };
    if (session.isContinuation && !isUiInteraction && currentSpecification && request.responseMode === "complete-ui") {
      yield event({
        type: "ui-started",
        specification: currentSpecification,
        dataRegistry: {
          version: "1",
          revision: dataRevision,
          data: {},
        },
        revision: interfaceRevision,
      });
    }
    try {
      runtime = await createRuntime(
        requestSessionFactory,
        request.responseMode,
        paymentConfirmationGrant,
        paymentWriteGrant,
      );
      for await (const source of runtime.orchestrator.stream(agentQuery, {
        ...(signal ? { signal } : {}),
        streamId: request.correlationId,
        ...(paymentConfirmationIntentId ? { paymentConfirmationIntentId } : {}),
      })) {
        if (source.type === "status") {
          if (
            request.responseMode !== "complete-ui"
            && (source.stage === "generating-ui" || source.stage === "rendering-ui")
          ) continue;
          const statusAt = now();
          if (source.stage === "consulting-tools") {
            agentLatencyMs ??= roundedDuration(statusAt - startedAt);
            mcpStartedAt ??= statusAt;
          } else if (source.stage === "planning" && mcpStartedAt !== undefined) {
            mcpLatencyMs += statusAt - mcpStartedAt;
            mcpStartedAt = undefined;
          } else if (source.stage === "generating-ui") {
            agentLatencyMs ??= roundedDuration(statusAt - startedAt);
            uiPlanningStartedAt ??= statusAt;
          }
          yield event({
            type: "status",
            status: agentStatusSchema.parse({
              version: "1",
              stage: mapAgentStage(source.stage),
              message: source.message,
            }),
          });
        } else if (source.type === "tool-completed") {
          const sourceCompletedAt = now();
          dataReadyAt ??= sourceCompletedAt;
          dataSources.push(source.source);
          dataSources.sort(compareSourceIds);
          const dataPatch = createDataPatchForSource(source.source);
          hasPartialData = true;
          yield event({ type: "data-patch", patch: dataPatch });
          if (request.responseMode === "complete-ui" && !currentSpecification && allowsCollectionPreview(agentQuery)) {
            const provisional = createProvisionalUiPayload(source.source, dataRevision, sourceOffset);
            if (provisional) {
              currentSpecification = provisional.specification;
              firstUiAt = sourceCompletedAt;
              yield event({
                type: "ui-started",
                specification: provisional.specification,
                dataRegistry: provisional.dataRegistry,
                revision: interfaceRevision,
              });
            }
          }
        } else if (source.type === "ui-snapshot") {
          if (request.responseMode !== "complete-ui") continue;
          const snapshotAt = now();
          if (uiPlanningStartedAt !== undefined) {
            uiPlanningLatencyMs += snapshotAt - uiPlanningStartedAt;
            uiPlanningStartedAt = undefined;
          }
          const snapshotDataSources = source.dataSources ?? dataSources;
          for (const snapshotSource of snapshotDataSources) {
            if (dataSources.some((candidate) => candidate.id === snapshotSource.id)) continue;
            dataSources.push(snapshotSource);
            dataSources.sort(compareSourceIds);
            const dataPatch = createDataPatchForSource(snapshotSource);
            hasPartialData = true;
            yield event({ type: "data-patch", patch: dataPatch });
          }
          const payload = adaptPayload(source.ui, snapshotDataSources);
          if (!currentSpecification) {
            registerInlinePayloadData(payload);
            currentUi = source.ui;
            currentSpecification = payload.specification;
            firstUiAt = snapshotAt;
            yield event({
              type: "ui-started",
              specification: payload.specification,
              dataRegistry: payload.dataRegistry,
              revision: interfaceRevision,
            });
          } else {
            for (const dataPatch of createMissingPayloadDataPatches(payload)) {
              hasPartialData = true;
              yield event({ type: "data-patch", patch: dataPatch });
            }
            const patches = createSharedUiPatches(currentSpecification, payload.specification, interfaceRevision);
            firstUiAt ??= now();
            currentUi = source.ui;
            currentSpecification = payload.specification;
            for (const patch of patches) {
              interfaceRevision = patch.revision;
              logUiPatch(request.correlationId, patch);
              yield event({ type: "ui-patch", patch });
            }
          }
        } else if (source.type === "ui-patch") {
          if (request.responseMode !== "complete-ui") continue;
          if (!currentUi || !currentSpecification) continue;
          const next = applyUiPatch(currentUi, dataSources, {
            version: "1.0",
            operations: [source.operation],
            dataSources,
          });
          const payload = adaptPayload(next.document, next.dataSources);
          for (const dataPatch of createMissingPayloadDataPatches(payload)) {
            hasPartialData = true;
            yield event({ type: "data-patch", patch: dataPatch });
          }
          const patches = createSharedUiPatches(currentSpecification, payload.specification, interfaceRevision);
          firstUiAt ??= now();
          currentUi = next.document;
          currentSpecification = payload.specification;
          for (const patch of patches) {
            interfaceRevision = patch.revision;
            logUiPatch(request.correlationId, patch);
            yield event({ type: "ui-patch", patch });
          }
        } else if (source.type === "completed") {
          for (const completedSource of [...source.response.dataSources].sort(compareSourceIds)) {
            const completedKey = adaptUiDataSource(completedSource, sourceOffset).key;
            if (refreshedDataKeys.has(completedKey)) continue;
            const dataPatch = createDataPatchForSource(completedSource);
            hasPartialData = true;
            yield event({ type: "data-patch", patch: dataPatch });
          }
          for (const delta of splitText(source.response.answer)) {
            hasPartialData = true;
            yield event({ type: "text-delta", delta });
          }
          if (request.responseMode === "complete-ui") {
            const payload = adaptPayload(source.response.ui, source.response.dataSources);
            logger.info("Generative UI validada para el contrato compartido", {
              correlationId: request.correlationId,
              rootType: payload.specification.root.type,
              dataSourceCount: Object.keys(payload.dataRegistry.data).length,
            });
            if (!currentSpecification) {
              registerInlinePayloadData(payload);
              firstUiAt = now();
              currentSpecification = payload.specification;
              yield event({
                type: "ui-started",
                specification: payload.specification,
                dataRegistry: payload.dataRegistry,
                revision: interfaceRevision,
              });
            } else {
              for (const dataPatch of createMissingPayloadDataPatches(payload)) {
                hasPartialData = true;
                yield event({ type: "data-patch", patch: dataPatch });
              }
              if (JSON.stringify(currentSpecification) !== JSON.stringify(payload.specification)) {
                const patches = createSharedUiPatches(currentSpecification, payload.specification, interfaceRevision);
                firstUiAt ??= now();
                currentSpecification = payload.specification;
                for (const patch of patches) {
                  interfaceRevision = patch.revision;
                  logUiPatch(request.correlationId, patch);
                  yield event({ type: "ui-patch", patch });
                }
              }
            }
            if (session.isContinuation) {
              for (const key of initialDataKeys) {
                if (refreshedDataKeys.has(key)) continue;
                const dataPatch = dataPatchSchema.parse({
                  version: "1",
                  baseRevision: dataRevision,
                  revision: dataRevision + 1,
                  op: "invalidate",
                  key,
                });
                dataRevision = dataPatch.revision;
                invalidatedKeys.add(key);
                logDataPatch(request.correlationId, dataPatch);
                yield event({ type: "data-patch", patch: dataPatch });
              }
            }
            await sessionStore.complete({
              actorId,
              sessionId: request.sessionId,
              correlationId: request.correlationId,
              interfaceRevision,
              dataRevision,
              dataKeys: [...knownDataKeys],
              dataRegistry: snapshotData,
              invalidatedKeys: [...invalidatedKeys],
              ...(currentSpecification ? { specification: currentSpecification } : {}),
              ...(!isUiInteraction ? { prompt: request.query } : {}),
              answer: source.response.answer,
              ...(isUiInteraction ? { interaction: request.uiEvent.event } : {}),
              ...paymentIntentSessionUpdate(source.response.dataSources),
            });
            isSessionCompleted = true;
            yield event({ type: "ui-completed", revision: interfaceRevision });
            const completedAt = now();
            const timeToFirstUiMs = Math.round((firstUiAt ?? completedAt) - startedAt);
            const totalGenerationMs = Math.round(completedAt - startedAt);
            logger.info("Métricas de Generative UI", {
              correlationId: request.correlationId,
              agentLatencyMs: agentLatencyMs ?? roundedDuration((dataReadyAt ?? firstUiAt ?? completedAt) - startedAt),
              mcpLatencyMs: roundedDuration(mcpLatencyMs),
              dataLatencyMs: roundedDuration((dataReadyAt ?? startedAt) - startedAt),
              uiPlanningLatencyMs: roundedDuration(uiPlanningLatencyMs),
              timeToFirstUiMs,
              timeToFirstUsefulUiMs: timeToFirstUiMs,
              totalGenerationMs,
            });
            yield event({
              type: "metrics",
              agentLatencyMs: agentLatencyMs ?? roundedDuration((dataReadyAt ?? firstUiAt ?? completedAt) - startedAt),
              mcpLatencyMs: roundedDuration(mcpLatencyMs),
              dataLatencyMs: roundedDuration((dataReadyAt ?? startedAt) - startedAt),
              uiPlanningLatencyMs: roundedDuration(uiPlanningLatencyMs),
              timeToFirstUiMs,
              timeToFirstUsefulUiMs: timeToFirstUiMs,
              totalGenerationMs,
            });
          }
          if (request.responseMode !== "complete-ui") {
            await sessionStore.complete({
              actorId,
              sessionId: request.sessionId,
              correlationId: request.correlationId,
              interfaceRevision,
              dataRevision,
              dataKeys: [...knownDataKeys],
              dataRegistry: snapshotData,
              invalidatedKeys: [...invalidatedKeys],
              ...(!isUiInteraction ? { prompt: request.query } : {}),
              answer: source.response.answer,
              ...(isUiInteraction ? { interaction: request.uiEvent.event } : {}),
              ...paymentIntentSessionUpdate(source.response.dataSources),
            });
            isSessionCompleted = true;
          }
          yield event({ type: "completed" });
        } else if (source.type === "cancelled") {
          await preserveSession();
          yield event({ type: "cancelled", hasPartialData: source.hasPartialData });
          return;
        } else if (source.type === "error") {
          await preserveSession();
          yield event({
            type: "error",
            error: errorPayloadSchema.parse({
              version: "1",
              code: source.code,
              message: source.message,
              recoverable: source.recoverable,
              hasPartialData: source.hasPartialData,
              correlationId: request.correlationId,
            }),
          });
          return;
        }
      }
    } catch (error) {
      await preserveSession();
      logger.error("Text Agent no pudo adaptar o transmitir la respuesta", {
        correlationId: request.correlationId,
        errorType: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : "Error no identificado",
      });
      if (signal?.aborted) {
        yield event({ type: "cancelled", hasPartialData });
      } else {
        yield event({
          type: "error",
          error: errorPayloadSchema.parse({
            version: "1",
            code: "agent_unavailable",
            message: "El agente no está disponible temporalmente",
            recoverable: true,
            hasPartialData,
            correlationId: request.correlationId,
          }),
        });
      }
    } finally {
      try {
        await sessionStore.release(actorId, request.sessionId, request.correlationId);
      } catch (error) {
        logger.warn("No fue posible liberar el bloqueo de sesión", {
          correlationId: request.correlationId,
          errorType: error instanceof Error ? error.name : "unknown",
        });
      }
      await runtime?.close();
    }

    async function preserveSession(): Promise<void> {
      if (isSessionCompleted) return;
      await sessionStore.complete({
        actorId,
        sessionId: request.sessionId,
        correlationId: request.correlationId,
        interfaceRevision,
        dataRevision,
        dataKeys: [...knownDataKeys],
        dataRegistry: snapshotData,
        invalidatedKeys: [...invalidatedKeys],
        ...(currentSpecification ? { specification: currentSpecification } : {}),
        ...(!isUiInteraction ? { prompt: request.query } : {}),
        answer: "",
        ...paymentIntentSessionUpdate(dataSources),
      });
      isSessionCompleted = true;
    }
  };
}

function paymentIntentSessionUpdate(
  dataSources: readonly UiDataSource[],
): { pendingPaymentIntentId: string | null } | Record<string, never> {
  const terminal = dataSources.find((source) => (
    source.toolName === "confirm_payment" || source.toolName === "cancel_payment_intent"
  ));
  if (terminal) return { pendingPaymentIntentId: null };

  const created = dataSources.find((source) => source.toolName === "create_payment_intent");
  if (!created || !isRecord(created.data) || created.data.status !== "awaiting_confirmation") return {};
  const id = created.data.id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/iu.test(id)
    ? { pendingPaymentIntentId: id }
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapAgentStage(stage: "planning" | "consulting-tools" | "generating-ui" | "rendering-ui") {
  if (stage === "consulting-tools") return "retrieving_data" as const;
  if (stage === "generating-ui" || stage === "rendering-ui") return "generating_ui" as const;
  return "thinking" as const;
}

function compareSourceIds(left: UiDataSource, right: UiDataSource): number {
  return Number(left.id.slice("source-".length)) - Number(right.id.slice("source-".length));
}

function allowsCollectionPreview(query: string): boolean {
  return allowsProvisionalCollectionPreview(query);
}

const textOnlyDocument: UiDocument = UiDocumentSchema.parse({
  version: "1.0",
  root: {
    id: "text-response",
    type: "text",
    text: "Respuesta textual",
    variant: "body",
  },
});

const textOnlyUiGenerator: UiGenerator = {
  generate: async () => textOnlyDocument,
};

function splitText(text: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += 2_000) {
    chunks.push(text.slice(offset, offset + 2_000));
  }
  return chunks;
}

function roundedDuration(durationMs: number): number {
  return Math.max(0, Math.round(durationMs));
}

function logUiPatch(correlationId: string, patch: ReturnType<typeof createSharedUiPatch>): void {
  logger.info("UIPatch validado para el frontend", {
    correlationId,
    operation: patch.op,
    target: patch.target,
    baseRevision: patch.baseRevision,
    revision: patch.revision,
  });
}

function logDataPatch(
  correlationId: string,
  patch: ReturnType<typeof dataPatchSchema.parse>,
): void {
  logger.info("DataRegistry patch validado para el frontend", {
    correlationId,
    operation: patch.op,
    key: patch.key,
    baseRevision: patch.baseRevision,
    revision: patch.revision,
  });
}

function sessionErrorMessage(
  code: "session_busy" | "session_forbidden" | "session_not_found" | "session_revision_conflict",
): string {
  if (code === "session_busy") return "La sesión ya está procesando otra solicitud";
  if (code === "session_forbidden") return "La sesión no pertenece al usuario autenticado";
  if (code === "session_not_found") return "La sesión ya no está disponible";
  return "La sesión cambió antes de procesar esta solicitud";
}

export type TextAgentService = ReturnType<typeof createTextAgentService>;

function createRuntimeForMode(
  sessionFactory: SessionFactory,
  responseMode: TextAgentRequest["responseMode"],
  paymentConfirmationGrant?: PaymentConfirmationGrant,
  paymentWriteGrant?: PaymentWriteGrant,
) {
  return createAgentRuntime(
    sessionFactory,
    {
      ...(responseMode === "text" ? { uiGenerator: textOnlyUiGenerator } : {}),
      ...(paymentConfirmationGrant ? { paymentConfirmationGrant } : {}),
      ...(paymentWriteGrant ? { paymentWriteGrant } : {}),
    },
  );
}
