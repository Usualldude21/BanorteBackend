# Propuesta de contratos de pagos

Esta propuesta cubre el hueco encontrado en `@banorte/contracts`. Los nombres SQL permanecen en snake_case; el servicio debe devolver camelCase y montos como decimal string.

## Estados comunes

`draft | awaiting_confirmation | executing | succeeded | failed | expired | cancelled`

## Crear intención

Entrada: `sourceAccountId`, `beneficiaryId`, `amount`, `currency`, `concept` e `idempotencyKey`. Salida: `id`, los identificadores seguros, `amount`, `currency`, `concept`, `fee`, `estimatedBalanceAfter`, `status`, `idempotencyKey` y `expiresAt`.

## Confirmar

Entrada: `paymentIntentId` y `correlationId` opcional. Salida: `paymentId`, `paymentIntentId`, `status`, `receiptNumber`, `amount`, `currency`, `fee`, `balanceBefore`, `balanceAfter` y `executedAt`.

## Consultar y cancelar

La consulta devuelve `paymentIntentId`, `status` y, sólo si existe, comprobante, saldo posterior y fecha de ejecución. La cancelación devuelve `id`, `status` y `updatedAt`.

## Errores que debe normalizar el backend

| SQLSTATE / mensaje | Código contractual propuesto |
|---|---|
| `42501` | `forbidden` o `authentication_required` |
| `P0002` | `not_found` |
| `22023` | `invalid_payment_data` |
| `P0001: insufficient funds` | `insufficient_funds` |
| `P0001: payment intent expired` | `payment_intent_expired` |
| Otros `P0001` de estado | `invalid_payment_state` |

Antes de integrarlo se deben aprobar los límites del concepto, si la idempotency key se expone al frontend y la representación contractual de errores. Las RPC no devuelven `user_id`, cuentas completas ni auditoría.
