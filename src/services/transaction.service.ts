import { logger } from "../config/logger.js";
import { type TransactionReader } from "../application/ports/financial-data.js";
import {
  type TransactionProjection,
  type GetTransactionsInput,
  type GetTransactionsOutput,
} from "../schemas/get-transactions.schema.js";
import { type Transaction } from "../domain/transaction.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";

export class TransactionService {
  constructor(
    private readonly repository: TransactionReader,
    private readonly user: AuthenticatedUser,
  ) {}

  async obtenerTransacciones(
    input: GetTransactionsInput,
  ): Promise<GetTransactionsOutput> {
    logger.debug("TransactionService: consultando transacciones");

    const transacciones = await this.repository.obtenerPorFiltro({
      user_id: this.user.id,
      account_id: input.accountId,
      type: input.transactionType,
      category: input.category,
      start_date: input.startDate,
      end_date: input.endDate,
      limit: input.limit,
      offset: input.offset,
    });

    const hasMore = transacciones.length > input.limit;
    const pagina = transacciones.slice(0, input.limit);

    logger.info("TransactionService: transacciones obtenidas", {
      returned: pagina.length,
      hasMore,
    });

    return {
      transactions: pagina.map(proyectarTransaccion),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        returned: pagina.length,
        hasMore,
      },
      metadata: {
        queriedAt: new Date().toISOString(),
        appliedFilters: {
          accountId: input.accountId,
          startDate: input.startDate,
          endDate: input.endDate,
          category: input.category,
          transactionType: input.transactionType,
        },
      },
    };
  }
}

function proyectarTransaccion(tx: Transaction): TransactionProjection {
  return {
    id: tx.id,
    accountId: tx.account_id,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    description: tx.description,
    category: tx.category,
    transactionDate: tx.transaction_date,
  };
}
