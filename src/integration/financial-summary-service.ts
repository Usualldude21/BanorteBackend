import {
  financialSummaryResponseSchema,
  type FinancialSummaryRequest,
  type FinancialSummaryResponse,
} from "@banorte/contracts";
import { env } from "../config/env.js";
import {
  createAuthenticatedSupabaseSession,
  type AuthenticatedSupabaseSession,
} from "../config/supabase.js";
import { type SessionFactory } from "../agent/cli/agent-runtime.js";
import { FinancialMcpClient, type FinancialToolClient } from "../agent/mcp-client/financial-mcp-client.js";
import { FinancialPeriodInputSchema, FinancialSummaryOutputSchema } from "../schemas/analytics.schema.js";
import { crearServidor } from "../server.js";

interface ClosableFinancialToolClient extends FinancialToolClient {
  close(): Promise<void>;
}

interface FinancialSummaryServiceDependencies {
  createSession?: () => Promise<AuthenticatedSupabaseSession>;
  createClient?: (session: AuthenticatedSupabaseSession) => Promise<ClosableFinancialToolClient>;
}

export function createFinancialSummaryService(
  dependencies: FinancialSummaryServiceDependencies = {},
) {
  const createSession = dependencies.createSession ?? createAuthenticatedSupabaseSession;
  const createClient = dependencies.createClient ?? connectFinancialMcpClient;

  return async (
    request: FinancialSummaryRequest,
    signal?: AbortSignal,
    authenticatedSessionFactory?: SessionFactory,
  ): Promise<FinancialSummaryResponse> => {
    const input = FinancialPeriodInputSchema.parse({
      startDate: request.startDate,
      endDate: request.endDate,
      ...(request.currency ? { currency: request.currency } : {}),
    });
    const session = await (authenticatedSessionFactory ?? createSession)();
    const client = await createClient(session);

    try {
      const output = FinancialSummaryOutputSchema.parse(await client.callTool({
        name: "get_financial_summary",
        arguments: input,
      }, signal));

      return financialSummaryResponseSchema.parse({
        version: "1",
        correlationId: request.correlationId,
        dataRegistry: {
          version: "1",
          revision: 0,
          data: {
            financialSummary: {
              summaries: output.summaries,
              metadata: output.metadata,
            },
          },
        },
      });
    } finally {
      await client.close();
    }
  };
}

async function connectFinancialMcpClient(session: AuthenticatedSupabaseSession) {
  return FinancialMcpClient.connect(crearServidor(session), env.AGENT_TOOL_TIMEOUT_MS);
}

export type FinancialSummaryService = ReturnType<typeof createFinancialSummaryService>;
