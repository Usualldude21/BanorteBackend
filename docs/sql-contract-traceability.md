# Matriz SQL → contrato

| Fuente SQL | Campo SQL | Servicio/RPC | Campo contractual | Formato | Sensibilidad |
|---|---|---|---|---|---|
| accounts | id | get_accounts | id | UUID | interna |
| accounts | type | get_accounts | type | enum | financiera |
| accounts | status | get_accounts | status | enum | financiera |
| accounts | balance | get_accounts | balance | decimal string | financiera |
| accounts | masked_identifier | get_accounts | maskedIdentifier | string enmascarado | financiera |
| transactions | account_id | get_transactions | accountId | UUID | interna |
| transactions | transaction_date | get_transactions | transactionDate | YYYY-MM-DD | financiera |
| transactions | amount | get_transactions | amount | decimal string | financiera |
| get_financial_summary | total_income | AnalyticsService | totalIncome | decimal string | financiera |
| get_financial_summary | total_expenses | AnalyticsService | totalExpenses | decimal string | financiera |
| get_financial_summary | net_cash_flow | AnalyticsService | netCashFlow | decimal string | financiera |
| get_spending_by_category | transaction_count | AnalyticsService | transactionCount | integer | agregada |
| get_cashflow | period_start | AnalyticsService | periodStart | YYYY-MM-DD | agregada |
| payments | receipt_number | confirm_payment | receiptNumber (propuesto) | string | interna |
| payments | balance_after | confirm_payment | balanceAfter (propuesto) | decimal string | financiera |
| payment_intents | estimated_balance_after | create_payment_intent | estimatedBalanceAfter (propuesto) | decimal string | financiera |

Los tres campos marcados como propuestos no se añadieron a `@banorte/contracts`: el paquete actual no define pagos. El responsable del contrato debe aprobar schemas para intent, confirmación, estado, cancelación y errores antes de exponer estas RPC mediante servicios o herramientas públicas.
