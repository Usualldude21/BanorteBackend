import { logger } from "../config/logger.js";
import { type AccountReader } from "../application/ports/financial-data.js";
import {
  type AccountProjection,
  type GetAccountsOutput,
} from "../schemas/get-accounts.schema.js";
import { type Account } from "../domain/account.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";

export class AccountService {
  constructor(
    private readonly repository: AccountReader,
    private readonly user: AuthenticatedUser,
  ) {}

  async obtenerCuentasDeUsuario(): Promise<GetAccountsOutput> {
    logger.debug("AccountService: obteniendo cuentas");

    const cuentas = await this.repository.obtenerPorUsuario({
      user_id: this.user.id,
    });

    logger.info("AccountService: cuentas obtenidas", { total: cuentas.length });

    return {
      accounts: cuentas.map(proyectarCuenta),
      metadata: {
        totalAccounts: cuentas.length,
        queriedAt: new Date().toISOString(),
      },
    };
  }
}

function proyectarCuenta(cuenta: Account): AccountProjection {
  return {
    id: cuenta.id,
    type: cuenta.type,
    status: cuenta.status,
    name: cuenta.name,
    currency: cuenta.currency,
    balance: cuenta.balance,
    maskedIdentifier: cuenta.masked_identifier,
  };
}
