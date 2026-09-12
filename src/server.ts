import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SupabaseClient } from "@supabase/supabase-js";
import { type AuthenticatedUser } from "./application/authenticated-user.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { AccountRepository } from "./repositories/account.repository.js";
import { TransactionRepository } from "./repositories/transaction.repository.js";
import { AnalyticsRepository } from "./repositories/analytics.repository.js";
import { AnomalyRepository } from "./repositories/anomaly.repository.js";
import { BeneficiaryRepository } from "./repositories/beneficiary.repository.js";
import { PaymentRepository } from "./repositories/payment.repository.js";
import { AccountService } from "./services/account.service.js";
import { TransactionService } from "./services/transaction.service.js";
import { AnalyticsService } from "./services/analytics.service.js";
import { ComparisonService } from "./services/comparison.service.js";
import { AnomalyService } from "./services/anomaly.service.js";
import { SimulationService } from "./services/simulation.service.js";
import { FinancialHealthService } from "./services/financial-health.service.js";
import { BeneficiaryService } from "./services/beneficiary.service.js";
import { PaymentService } from "./services/payment.service.js";
import { registrarHerramientaPing } from "./tools/ping.tool.js";
import { registrarHerramientaGetAccounts } from "./tools/get-accounts.tool.js";
import { registrarHerramientaGetTransactions } from "./tools/get-transactions.tool.js";
import { registrarHerramientaComparePeriods, registrarHerramientasAnalytics } from "./tools/analytics.tools.js";
import { registrarHerramientaDetectAnomalies } from "./tools/detect-anomalies.tool.js";
import { registerSimulationTools } from "./tools/simulation.tools.js";
import { registerFinancialHealthTool } from "./tools/financial-health.tool.js";
import { registerGetBeneficiariesTool } from "./tools/get-beneficiaries.tool.js";
import { registerPaymentTools } from "./tools/payment.tools.js";
import { ToolRateLimiter } from "./application/tool-rate-limiter.js";
import { type PaymentConfirmationAuthorizer } from "./application/ports/payment-confirmation-authorization.js";
import { type PaymentWriteAuthorizer } from "./application/ports/payment-write-authorization.js";
import { registerFinancialResources } from "./resources/financial-resources.js";
import { financialToolRisk } from "./agent/tool-policy.js";

const sharedToolRateLimiter = new ToolRateLimiter({
  maxCalls: env.MCP_RATE_LIMIT_PER_MINUTE,
  windowMs: 60_000,
  policyForOperation: (operation) => {
    const risk = financialToolRisk(operation);
    return risk === "write" || risk === "critical-write"
      ? { maxCalls: env.MCP_WRITE_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 }
      : undefined;
  },
});

export interface ServerContext {
  client: SupabaseClient;
  user: AuthenticatedUser;
}

interface ServerOptions {
  paymentConfirmationAuthorizer?: PaymentConfirmationAuthorizer;
  paymentWriteAuthorizer?: PaymentWriteAuthorizer;
  rateLimiter?: ToolRateLimiter;
}

export function crearServidor(context: ServerContext, options: ServerOptions = {}): McpServer {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME,
    version: env.MCP_SERVER_VERSION,
  });

  const accountRepository = new AccountRepository(context.client);
  const accountService = new AccountService(accountRepository, context.user);

  const transactionRepository = new TransactionRepository(context.client);
  const transactionService = new TransactionService(
    transactionRepository,
    context.user,
  );
  const analyticsRepository = new AnalyticsRepository(context.client);
  const analyticsService = new AnalyticsService(analyticsRepository, context.user);
  const comparisonService = new ComparisonService(analyticsRepository, context.user);
  const anomalyService = new AnomalyService(
    new AnomalyRepository(context.client),
    context.user,
  );
  const simulationService = new SimulationService();
  const financialHealthService = new FinancialHealthService(
    analyticsRepository,
    accountRepository,
    context.user,
  );
  const beneficiaryService = new BeneficiaryService(
    new BeneficiaryRepository(context.client),
    context.user,
  );
  const paymentService = new PaymentService(new PaymentRepository(context.client));
  const rateLimiter = (options.rateLimiter ?? sharedToolRateLimiter).forScope(context.user.id);

  registrarHerramientaPing(server, rateLimiter);
  registrarHerramientaGetAccounts(server, accountService, rateLimiter);
  registrarHerramientaGetTransactions(server, transactionService, rateLimiter);
  registrarHerramientasAnalytics(server, analyticsService, rateLimiter);
  registrarHerramientaComparePeriods(server, comparisonService, rateLimiter);
  registrarHerramientaDetectAnomalies(server, anomalyService, rateLimiter);
  registerFinancialHealthTool(server, financialHealthService, rateLimiter);
  registerGetBeneficiariesTool(server, beneficiaryService, rateLimiter);
  registerPaymentTools(
    server,
    paymentService,
    rateLimiter,
    context.user,
    options.paymentWriteAuthorizer,
    options.paymentConfirmationAuthorizer,
  );
  registerSimulationTools(server, simulationService, rateLimiter);
  registerFinancialResources(server);

  logger.info("Servidor MCP configurado", {
    nombre: env.MCP_SERVER_NAME,
    version: env.MCP_SERVER_VERSION,
    totalHerramientas: 13
      + (options.paymentWriteAuthorizer ? 2 : 0)
      + (options.paymentConfirmationAuthorizer ? 1 : 0),
    totalRecursos: 4,
  });

  return server;
}
