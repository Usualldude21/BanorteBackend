# Base de datos de demostración

## Preparación y reset

Requiere Supabase CLI y Docker. Desde la raíz del repositorio:

```bash
supabase start
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/data_validation.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/payment_flow.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/session_persistence.sql
```

`supabase db reset` es también el procedimiento de recuperación: reconstruye el esquema, restaura saldos, elimina pagos de ensayos y recrea movimientos. El seed imprime datos únicamente mediante consultas explícitas; no registra contraseñas ni tokens. Las cuentas sintéticas usan el dominio reservado `example.invalid`.

## Usuarios de demo

| Escenario | Email | UUID |
|---|---|---|
| Camino feliz | `demo.a@example.invalid` | `10000000-0000-4000-8000-000000000001` |
| Aislamiento RLS | `demo.b@example.invalid` | `10000000-0000-4000-8000-000000000002` |
| Errores | `demo.c@example.invalid` | `10000000-0000-4000-8000-000000000003` |

La contraseña local común está comentada al inicio de `seed.sql`. No debe reutilizarse fuera del entorno local.

## Firmas RPC

| RPC | Parámetros | Resultado |
|---|---|---|
| `get_financial_summary` | `p_user_id`, `p_start_date`, `p_end_date`, `p_currency` | Totales por moneda |
| `get_spending_by_category` | mismos | Categorías y porcentajes |
| `get_cashflow` | mismos + `p_granularity` | Día, semana o mes |
| `create_payment_intent` | cuenta, beneficiario, importe, moneda, concepto, idempotency key generado por backend | Valida saldo y devuelve resumen pendiente; no cambia saldo |
| `confirm_payment` | intent, correlation id generado por backend | Comprobante idempotente |
| `cancel_payment_intent` | intent | Estado cancelado |
| `get_payment_status` | intent | Estado y comprobante seguro |
| `begin_agent_session` | sesión, correlación y revisiones | Crea o recupera una sesión y adquiere un bloqueo temporal |
| `complete_agent_session` | sesión, correlación y estado validado | Persiste el estado y libera el bloqueo |
| `release_agent_session` | sesión y correlación | Libera de forma idempotente una sesión interrumpida |

Las funciones obtienen la identidad con `auth.uid()`. El parámetro `p_user_id` de analítica sólo existe para mantener compatibilidad con el repositorio actual y debe coincidir con la sesión.

## Errores previstos

`42501` indica sesión ausente o acceso cruzado; `22023`, monto, moneda o granularidad inválidos; `P0002`, recurso no encontrado para el usuario; `P0001`, estado inválido, expiración, beneficiario no disponible o fondos insuficientes. La capa backend debe traducirlos a códigos contractuales estables sin exponer texto SQL.

## Prueba concurrente

Cree un intent nuevo y, desde dos sesiones autenticadas como Usuario A, ejecute al mismo tiempo `select * from confirm_payment('<intent>');`. Ambas respuestas deben contener el mismo `payment_id` y comprobante. Las consultas siguientes deben devolver `1`:

```sql
select count(*) from payments where payment_intent_id = '<intent>';
select count(*) from transactions where reference_id = 'PAY-<intent>';
```

El bloqueo de fila sobre el intent serializa las confirmaciones. La suite normal valida la misma garantía de forma secuencial y fuerza un error después de actualizar el saldo para comprobar rollback.
