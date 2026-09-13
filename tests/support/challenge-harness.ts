import {
  textAgentRequestSchema,
  textAgentStreamEventSchema,
  type TextAgentRequest,
  type TextAgentStreamEvent,
  type UIEvent,
} from "@banorte/contracts";
import { AgentOrchestrator } from "../../src/agent/orchestrator.js";
import { type FinancialToolClient } from "../../src/agent/mcp-client/financial-mcp-client.js";
import { type ModelGateway } from "../../src/agent/model/model.js";
import { type AgentToolCall, type AgentToolResult } from "../../src/agent/schemas/agent.schema.js";
import {
  createPaymentConfirmationAuthorizer,
  type PaymentConfirmationGrant,
} from "../../src/application/ports/payment-confirmation-authorization.js";
import {
  createPaymentWriteAuthorizer,
  type PaymentWriteGrant,
} from "../../src/application/ports/payment-write-authorization.js";
import {
  type BeginSessionInput,
  type BeginSessionResult,
  type CompleteSessionInput,
  type SessionStore,
} from "../../src/application/ports/session-store.js";
import { AgentSessionStore } from "../../src/integration/agent-session-store.js";
import { createTextAgentService, type TextAgentService } from "../../src/integration/text-agent-service.js";
import { SimulationService } from "../../src/services/simulation.service.js";
import { UiDocumentSchema, type UiDocument } from "../../src/ui/dsl/ui.schema.js";
import { createIntentAwareUiFallback } from "../../src/ui/generation/intent-aware-ui-fallback.js";
import { type UiGenerator } from "../../src/ui/generation/ui-generator.js";
import { validateToolOutput } from "../../src/agent/mcp-client/tool-output-validator.js";

export const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
export const ACCOUNT_ID = "40000000-0000-4000-8000-000000000001";
export const BENEFICIARY_ID = "60000000-0000-4000-8000-000000000001";
export const PAYMENT_INTENT_ID = "50000000-0000-4000-8000-000000000001";
const PAYMENT_ID = "70000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "90000000-0000-4000-8000-000000000001";
const QUERIED_AT = "2026-09-12T12:00:00.000Z";

export interface RecordedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class ChallengeHarness {
  readonly bank = new ChallengeBank();
  readonly sessions = new RecordingSessionStore();
  readonly toolCalls: RecordedToolCall[] = [];
  readonly modelQueries: string[] = [];
  readonly service: TextAgentService;

  constructor(options: { uiGenerationDelayMs?: number } = {}) {
    const uiGenerator: UiGenerator = options.uiGenerationDelayMs
      ? {
        generate: async (input, signal) => {
          await new Promise((resolve) => setTimeout(resolve, options.uiGenerationDelayMs));
          return challengeUiGenerator.generate(input, signal);
        },
      }
      : challengeUiGenerator;
    this.service = createTextAgentService({
      sessionStore: this.sessions,
      sessionFactory: async () => ({ client: {} as never, user: { id: ACTOR_ID } }),
      createRuntime: async (_sessionFactory, _responseMode, confirmationGrant, writeGrant) => {
        const tools = new ChallengeToolClient(
          this.bank,
          this.toolCalls,
          writeGrant,
          confirmationGrant,
        );
        const permittedToolNames = [
          "get_accounts",
          "get_transactions",
          "get_spending_by_category",
          "simulate_savings",
          ...(writeGrant ? ["create_payment_intent"] : []),
          ...(confirmationGrant ? ["confirm_payment"] : []),
        ];
        const orchestrator = new AgentOrchestrator(
          createChallengeModel(this.modelQueries),
          tools,
          uiGenerator,
          {
            maxToolCalls: 4,
            maxReasoningRepairs: 0,
            currentDate: () => "2026-09-12",
            userId: ACTOR_ID,
            permittedToolNames,
          },
        );
        return { orchestrator, close: async () => undefined };
      },
    });
  }

  async run(request: unknown): Promise<TextAgentStreamEvent[]> {
    const parsed = textAgentRequestSchema.parse(request);
    const events: TextAgentStreamEvent[] = [];
    for await (const event of this.service(parsed)) {
      events.push(textAgentStreamEventSchema.parse(event));
    }
    return events;
  }
}

export class RecordingSessionStore implements SessionStore {
  private readonly delegate = new AgentSessionStore(() => Date.parse(QUERIED_AT));
  readonly completions: CompleteSessionInput[] = [];

  begin(input: BeginSessionInput): Promise<BeginSessionResult> {
    return this.delegate.begin(input);
  }

  async complete(input: CompleteSessionInput): Promise<void> {
    await this.delegate.complete(input);
    this.completions.push(structuredClone(input));
  }

  release(actorId: string, sessionId: string, correlationId: string): Promise<void> {
    return this.delegate.release(actorId, sessionId, correlationId);
  }

  latest(): CompleteSessionInput {
    const completion = this.completions.at(-1);
    if (!completion) throw new Error("La sesión no tiene una finalización registrada");
    return completion;
  }
}

export class ChallengeBank {
  balanceCents = 3_874_265;
  readonly payments: Array<Record<string, unknown>> = [];
  readonly transactions: Array<Record<string, unknown>> = [];
  private paymentIntent: Record<string, unknown> | undefined;

  execute(call: AgentToolCall): unknown {
    switch (call.name) {
      case "get_accounts":
        return validateToolOutput(call.name, this.accounts());
      case "get_transactions":
        return validateToolOutput(call.name, this.transactionHistory(call.arguments));
      case "get_spending_by_category":
        return validateToolOutput(call.name, this.spending());
      case "simulate_savings":
        return validateToolOutput(call.name, new SimulationService().simulateSavings({
          initialAmount: String(call.arguments.initialAmount),
          periodicContribution: String(call.arguments.periodicContribution),
          annualRate: String(call.arguments.annualRate),
          durationMonths: Number(call.arguments.durationMonths),
          frequency: "monthly",
        }));
      case "create_payment_intent":
        return validateToolOutput(call.name, this.createIntent(call.arguments));
      case "confirm_payment":
        return validateToolOutput(call.name, this.confirmPayment(call.arguments));
      default:
        throw new Error(`Herramienta inesperada: ${call.name}`);
    }
  }

  private accounts() {
    return {
      accounts: [{
        id: ACCOUNT_ID,
        type: "checking",
        status: "active",
        name: "Cuenta Nómina Principal",
        currency: "MXN",
        balance: formatCents(this.balanceCents),
        maskedIdentifier: "****0527",
      }],
      metadata: { totalAccounts: 1, queriedAt: QUERIED_AT },
    };
  }

  private spending() {
    return {
      categories: [
        { currency: "MXN", category: "restaurants", amount: "8500.00", percentage: "53.13", transactionCount: 12 },
        { currency: "MXN", category: "groceries", amount: "5000.00", percentage: "31.25", transactionCount: 8 },
        { currency: "MXN", category: "transport", amount: "2500.00", percentage: "15.62", transactionCount: 10 },
      ],
      metadata: {
        queriedAt: QUERIED_AT,
        startDate: "2026-09-01",
        endDate: "2026-09-12",
        currency: "MXN",
      },
    };
  }

  private transactionHistory(argumentsValue: Record<string, unknown>) {
    const limit = Number(argumentsValue.limit ?? 20);
    const offset = Number(argumentsValue.offset ?? 0);
    const rows = this.transactions.slice(offset, offset + limit);
    return {
      transactions: rows,
      pagination: {
        limit,
        offset,
        returned: rows.length,
        hasMore: offset + limit < this.transactions.length,
      },
      metadata: { queriedAt: QUERIED_AT, appliedFilters: {} },
    };
  }

  private createIntent(argumentsValue: Record<string, unknown>) {
    if (
      argumentsValue.sourceAccountId !== ACCOUNT_ID
      || argumentsValue.beneficiaryId !== BENEFICIARY_ID
      || argumentsValue.currency !== "MXN"
      || argumentsValue.amount !== "500.00"
    ) {
      throw new Error("El pago sintético no coincide con el escenario autorizado");
    }
    this.paymentIntent ??= {
      id: PAYMENT_INTENT_ID,
      sourceAccountId: ACCOUNT_ID,
      beneficiaryId: BENEFICIARY_ID,
      amount: "500.00",
      currency: "MXN",
      concept: "Reto Banorte",
      fee: "0.00",
      estimatedBalanceAfter: formatCents(this.balanceCents - 50_000),
      status: "awaiting_confirmation",
      idempotencyKey: IDEMPOTENCY_KEY,
      expiresAt: "2026-09-12T12:10:00.000Z",
    };
    return this.paymentIntent;
  }

  private confirmPayment(argumentsValue: Record<string, unknown>) {
    if (
      argumentsValue.paymentIntentId !== PAYMENT_INTENT_ID
      || argumentsValue.confirmed !== true
      || !this.paymentIntent
    ) {
      throw new Error("Intent de pago inválido");
    }
    const previous = this.payments[0];
    if (previous) return previous;

    const balanceBefore = this.balanceCents;
    this.balanceCents -= 50_000;
    const receipt = {
      paymentId: PAYMENT_ID,
      paymentIntentId: PAYMENT_INTENT_ID,
      status: "succeeded",
      receiptNumber: "MOC-5000000000005000",
      amount: "500.00",
      currency: "MXN",
      fee: "0.00",
      balanceBefore: formatCents(balanceBefore),
      balanceAfter: formatCents(this.balanceCents),
      executedAt: QUERIED_AT,
    };
    this.payments.push(receipt);
    this.transactions.push({
      id: "80000000-0000-4000-8000-000000000001",
      accountId: ACCOUNT_ID,
      type: "payment",
      amount: "500.00",
      currency: "MXN",
      description: "Reto Banorte",
      category: "transfers",
      transactionDate: "2026-09-12",
    });
    this.paymentIntent = { ...this.paymentIntent, status: "succeeded" };
    return receipt;
  }
}

class ChallengeToolClient implements FinancialToolClient {
  private readonly writeAuthorizer;
  private readonly confirmationAuthorizer;

  constructor(
    private readonly bank: ChallengeBank,
    private readonly calls: RecordedToolCall[],
    writeGrant?: PaymentWriteGrant,
    confirmationGrant?: PaymentConfirmationGrant,
  ) {
    this.writeAuthorizer = createPaymentWriteAuthorizer(writeGrant);
    this.confirmationAuthorizer = createPaymentConfirmationAuthorizer(confirmationGrant);
  }

  async listTools() {
    return [
      "get_accounts",
      "get_transactions",
      "get_spending_by_category",
      "simulate_savings",
      "create_payment_intent",
      "confirm_payment",
    ].map((name) => ({ name, description: `Herramienta financiera ${name}`, inputSchema: { type: "object" } }));
  }

  async callTool(call: AgentToolCall): Promise<unknown> {
    if (call.name === "create_payment_intent" && !this.writeAuthorizer.consume({
      actorId: ACTOR_ID,
      toolName: "create_payment_intent",
    })) {
      throw new Error("Escritura no autorizada");
    }
    if (call.name === "confirm_payment" && !this.confirmationAuthorizer.consume({
      actorId: ACTOR_ID,
      paymentIntentId: String(call.arguments.paymentIntentId),
    })) {
      throw new Error("Confirmación no autorizada");
    }
    this.calls.push({ name: call.name, arguments: structuredClone(call.arguments) });
    return this.bank.execute(call);
  }
}

function createChallengeModel(recordedQueries: string[]): ModelGateway {
  return {
    createSession: ({ query }) => {
      recordedQueries.push(query);
      const plan = planForQuery(query);
      let requestedTools = false;
      return {
        next: async (results: AgentToolResult[] = []) => {
          if (!requestedTools) {
            requestedTools = true;
            return { text: "", toolCalls: plan.calls };
          }
          return { text: plan.answer(results), toolCalls: [] };
        },
      };
    },
  };
}

function planForQuery(query: string): {
  calls: AgentToolCall[];
  answer: (results: AgentToolResult[]) => string;
} {
  const normalized = normalize(query);
  if (normalized.includes("payment.confirmed")) {
    return {
      calls: [{ name: "confirm_payment", arguments: { paymentIntentId: PAYMENT_INTENT_ID, confirmed: true } }],
      answer: () => "El pago bancario fue confirmado por $500.00 MXN y el comprobante proviene de la base de datos.",
    };
  }
  if (normalized.includes("transfiere") || normalized.includes("transferir")) {
    return {
      calls: [{
        name: "create_payment_intent",
        arguments: {
          sourceAccountId: ACCOUNT_ID,
          beneficiaryId: BENEFICIARY_ID,
          amount: "500.00",
          currency: "MXN",
          concept: "Reto Banorte",
        },
      }],
      answer: () => "El pago de $500.00 MXN está preparado y espera tu confirmación; el dinero aún no se ha movido.",
    };
  }
  if (normalized.includes("ahorrar") || normalized.includes("simulacion")) {
    const interactionContribution = simulationContributionFromQuery(query);
    const followUp = normalized.includes("1,000 mas") || normalized.includes("1000 mas");
    const contribution = interactionContribution ?? (followUp ? "7250.00" : "6250.00");
    return {
      calls: [
        { name: "get_accounts", arguments: {} },
        { name: "simulate_savings", arguments: {
          initialAmount: "0.00",
          periodicContribution: contribution,
          annualRate: "0.00",
          durationMonths: 8,
          frequency: "monthly",
        } },
      ],
      answer: (results) => {
        const simulation = resultOutput(results, "simulate_savings") as { projectedBalance: string };
        return `Escenario SIMULATED: el saldo proyectado es $${simulation.projectedBalance} MXN en 8 meses, asumiendo una tasa anual de 0%; es una estimación y no garantiza el resultado.`;
      },
    };
  }
  if (normalized.includes("yendo el dinero") || normalized.includes("gaste mas")) {
    return {
      calls: [{ name: "get_spending_by_category", arguments: {
        startDate: "2026-09-01",
        endDate: "2026-09-12",
        currency: "MXN",
      } }],
      answer: () => "En gastos, la categoría restaurantes concentra $8,500.00 MXN y es la de mayor importe del periodo.",
    };
  }
  if (normalized.includes("movimientos")) {
    return {
      calls: [
        { name: "get_accounts", arguments: {} },
        { name: "get_transactions", arguments: { limit: 20, offset: 0 } },
      ],
      answer: () => "Tu saldo bancario actualizado es $38,242.65 MXN y el movimiento de pago por $500.00 MXN está registrado.",
    };
  }
  return {
    calls: [{ name: "get_accounts", arguments: {} }],
    answer: () => "Tu saldo disponible es $38,742.65 MXN en tu cuenta bancaria principal.",
  };
}

const challengeUiGenerator: UiGenerator = {
  generate: async (input) => {
    const fallback = createIntentAwareUiFallback(input.query, input.dataSources);
    if (fallback) return UiDocumentSchema.parse(fallback);

    const accounts = input.dataSources.find((source) => source.toolName === "get_accounts");
    const transactions = input.dataSources.find((source) => source.toolName === "get_transactions");
    const spending = input.dataSources.find((source) => source.toolName === "get_spending_by_category");
    const simulation = input.dataSources.find((source) => source.toolName === "simulate_savings");
    let document: UiDocument;

    if (simulation) {
      const interactionContribution = simulationContributionFromQuery(input.query);
      const followUp = normalize(input.query).includes("1,000 mas") || normalize(input.query).includes("1000 mas");
      document = {
        version: "1.0",
        root: {
          id: "savings-plan",
          type: "card",
          title: "Escenario de ahorro",
          children: [
            { id: "projected-balance", type: "metric", label: "Saldo proyectado", value: { sourceId: simulation.id, path: "projectedBalance" }, format: "currency" },
            { id: "monthly-saving", type: "slider", label: "Ahorro mensual", min: 0, max: 15_000, step: 250, initialValue: interactionContribution ? Number(interactionContribution) : followUp ? 7_250 : 6_250, showValue: true },
          ],
        },
      };
    } else if (spending) {
      document = {
        version: "1.0",
        root: {
          id: "spending-analysis",
          type: "chart",
          title: "Gasto por categoría",
          chartType: "bar",
          data: { sourceId: spending.id, path: "categories" },
          categoryKey: "category",
          series: [{ key: "amount", label: "Monto" }],
        },
      };
    } else if (accounts && transactions) {
      document = {
        version: "1.0",
        root: {
          id: "updated-account",
          type: "card",
          title: "Cuenta actualizada",
          children: [
            { id: "updated-balance", type: "metric", label: "Saldo", value: { sourceId: accounts.id, path: "accounts.0.balance" }, format: "currency", currencyPath: "accounts.0.currency" },
            { id: "recent-movements", type: "table", title: "Movimientos", data: { sourceId: transactions.id, path: "transactions" }, columns: [{ key: "description", label: "Descripción" }, { key: "amount", label: "Monto" }], maxRows: 10 },
          ],
        },
      };
    } else if (accounts) {
      document = {
        version: "1.0",
        root: {
          id: "available-balance",
          type: "card",
          title: "Dinero disponible",
          children: [{ id: "balance", type: "metric", label: "Saldo", value: { sourceId: accounts.id, path: "accounts.0.balance" }, format: "currency", currencyPath: "accounts.0.currency" }],
        },
      };
    } else {
      throw new Error("El escenario no produjo datos para la interfaz");
    }
    return UiDocumentSchema.parse(document);
  },
};

export function queryRequest(sessionId: string, correlationId: string, query: string, sessionState?: CompleteSessionInput): TextAgentRequest {
  return textAgentRequestSchema.parse({
    version: "1",
    sessionId,
    correlationId,
    provider: "google",
    responseMode: "complete-ui",
    query,
    ...(sessionState ? { sessionState: referenceFrom(sessionState) } : {}),
  });
}

export function confirmationRequest(
  sessionId: string,
  correlationId: string,
  state: CompleteSessionInput,
  revisionOffset = 0,
): TextAgentRequest {
  return textAgentRequestSchema.parse({
    version: "1",
    sessionId,
    correlationId,
    provider: "google",
    responseMode: "complete-ui",
    uiEvent: {
      version: "1",
      sessionId,
      correlationId,
      interfaceRevision: state.interfaceRevision + revisionOffset,
      dataRevision: state.dataRevision,
      dataKeys: state.dataKeys,
      event: { name: "payment.confirmed", sourceId: "confirm-payment" },
    },
  });
}

export function interactionRequest(
  sessionId: string,
  correlationId: string,
  state: CompleteSessionInput,
  event: UIEvent["event"],
  revisionOffset = 0,
): TextAgentRequest {
  return textAgentRequestSchema.parse({
    version: "1",
    sessionId,
    correlationId,
    provider: "google",
    responseMode: "complete-ui",
    uiEvent: {
      version: "1",
      sessionId,
      correlationId,
      interfaceRevision: state.interfaceRevision + revisionOffset,
      dataRevision: state.dataRevision,
      dataKeys: state.dataKeys,
      event,
    },
  });
}

export function referenceFrom(state: CompleteSessionInput) {
  return {
    interfaceRevision: state.interfaceRevision,
    dataRevision: state.dataRevision,
    dataKeys: [...state.dataKeys],
  };
}

function resultOutput(results: AgentToolResult[], toolName: string): unknown {
  const result = results.find((candidate) => candidate.call.name === toolName);
  if (!result) throw new Error(`No se recibió el resultado de ${toolName}`);
  return result.output;
}

function formatCents(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function simulationContributionFromQuery(query: string): string | undefined {
  const match = /"intent":"simulation\.changed","value":(\d+(?:\.\d+)?)/u.exec(query);
  if (!match?.[1]) return undefined;
  return Number(match[1]).toFixed(2);
}
