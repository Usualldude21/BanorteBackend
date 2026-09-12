import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FinancialResourceSchema,
  type FinancialResource,
  type FinancialResourceUri,
} from "../schemas/financial-resource.schema.js";

interface ResourceDefinition {
  name: string;
  uri: FinancialResourceUri;
  title: string;
  description: string;
  content: FinancialResource;
}

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    name: "financial-categories",
    uri: "financial://categories",
    title: "Categorías financieras",
    description: "Reglas estables del modelo de categorías de transacciones.",
    content: FinancialResourceSchema.parse({
      schemaVersion: "1.0",
      kind: "categories",
      model: "controlled",
      maximumLength: 100,
      defaultWhenOmitted: "other",
      systemEntries: [
        { value: "income", label: "Ingresos", description: "Nómina y otros ingresos." },
        { value: "housing", label: "Vivienda", description: "Renta y vivienda." },
        { value: "transport", label: "Transporte", description: "Movilidad y transporte." },
        { value: "groceries", label: "Supermercado", description: "Compras de despensa." },
        { value: "restaurants", label: "Restaurantes", description: "Comidas fuera de casa." },
        { value: "entertainment", label: "Entretenimiento", description: "Ocio y entretenimiento." },
        { value: "health", label: "Salud", description: "Salud y farmacia." },
        { value: "education", label: "Educación", description: "Cursos y educación." },
        { value: "subscriptions", label: "Suscripciones", description: "Servicios recurrentes." },
        { value: "transfers", label: "Transferencias", description: "Transferencias y pagos a beneficiarios." },
        { value: "other", label: "Otros", description: "Gastos que no pertenecen a otra categoría." },
      ],
    }),
  },
  {
    name: "financial-account-types",
    uri: "financial://account-types",
    title: "Tipos de cuenta",
    description: "Tipos de cuenta aceptados por el dominio financiero.",
    content: FinancialResourceSchema.parse({
      schemaVersion: "1.0",
      kind: "account-types",
      entries: [
        { value: "checking", label: "Cuenta corriente", description: "Cuenta para operaciones y pagos habituales." },
        { value: "savings", label: "Cuenta de ahorro", description: "Cuenta destinada a mantener ahorro disponible." },
        { value: "credit_card", label: "Tarjeta de crédito", description: "Cuenta asociada a una tarjeta de crédito." },
      ],
    }),
  },
  {
    name: "financial-transaction-types",
    uri: "financial://transaction-types",
    title: "Tipos de transacción",
    description: "Tipos de movimiento aceptados por el dominio financiero.",
    content: FinancialResourceSchema.parse({
      schemaVersion: "1.0",
      kind: "transaction-types",
      entries: [
        { value: "income", label: "Ingreso", description: "Movimiento que incrementa los fondos considerados en el flujo." },
        { value: "expense", label: "Gasto", description: "Movimiento que reduce los fondos considerados en el flujo." },
        { value: "transfer", label: "Transferencia", description: "Movimiento entre cuentas que no se clasifica como ingreso ni gasto." },
        { value: "payment", label: "Pago", description: "Pago confirmado a un beneficiario que reduce el saldo." },
      ],
    }),
  },
  {
    name: "financial-metric-definitions",
    uri: "financial://metric-definitions",
    title: "Definiciones de métricas",
    description: "Semántica de las métricas deterministas expuestas por las herramientas analíticas.",
    content: FinancialResourceSchema.parse({
      schemaVersion: "1.0",
      kind: "metric-definitions",
      currencyHandling: "separate-series",
      definitions: [
        {
          name: "totalIncome",
          description: "Suma de importes clasificados como ingreso.",
          calculation: "sum(income.amount)",
          unit: "currency",
          nullable: false,
          sourceTools: ["get_financial_summary"],
        },
        {
          name: "totalExpenses",
          description: "Suma de importes clasificados como gasto.",
          calculation: "sum(expense.amount + payment.amount)",
          unit: "currency",
          nullable: false,
          sourceTools: ["get_financial_summary"],
        },
        {
          name: "netCashFlow",
          description: "Diferencia entre ingresos y gastos; las transferencias no modifican este valor.",
          calculation: "totalIncome - totalExpenses",
          unit: "currency",
          nullable: false,
          sourceTools: ["get_financial_summary", "get_cashflow"],
        },
        {
          name: "savingsRate",
          description: "Porcentaje del ingreso que permanece después de los gastos.",
          calculation: "100 * (totalIncome - totalExpenses) / totalIncome",
          unit: "percentage",
          nullable: true,
          sourceTools: ["get_financial_summary"],
        },
        {
          name: "transactionCount",
          description: "Número de transacciones del grupo, incluidas las transferencias cuando la herramienta no filtra solo gastos.",
          calculation: "count(transactions)",
          unit: "count",
          nullable: false,
          sourceTools: ["get_financial_summary", "get_spending_by_category", "get_cashflow"],
        },
        {
          name: "categoryPercentage",
          description: "Participación del gasto de una categoría en el gasto total de su misma moneda.",
          calculation: "100 * categoryExpense / totalExpenses",
          unit: "percentage",
          nullable: false,
          sourceTools: ["get_spending_by_category"],
        },
      ],
    }),
  },
];

export function registerFinancialResources(server: McpServer): void {
  for (const definition of RESOURCE_DEFINITIONS) {
    server.registerResource(
      definition.name,
      definition.uri,
      {
        title: definition.title,
        description: definition.description,
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri: definition.uri,
            mimeType: "application/json",
            text: JSON.stringify(definition.content),
          },
        ],
      }),
    );
  }
}
