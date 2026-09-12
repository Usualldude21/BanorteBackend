import { type UiNode } from "../../dsl/ui.schema.js";

type TextNode = Extract<UiNode, { type: "text" }>;
type MetricNode = Extract<UiNode, { type: "metric" }>;
type ChartNode = Extract<UiNode, { type: "chart" }>;
type HeatmapNode = Extract<UiNode, { type: "heatmap" }>;
type TableNode = Extract<UiNode, { type: "table" }>;
type AlertNode = Extract<UiNode, { type: "alert" }>;

export function TextPrimitive({ node }: { node: TextNode }) {
  if (node.variant === "title") {
    return <h2 data-ui-id={node.id} data-ui-type={node.type}>{node.text}</h2>;
  }
  if (node.variant === "subtitle") {
    return <h3 data-ui-id={node.id} data-ui-type={node.type}>{node.text}</h3>;
  }
  if (node.variant === "caption") {
    return <small data-ui-id={node.id} data-ui-type={node.type}>{node.text}</small>;
  }
  return <p data-ui-id={node.id} data-ui-type={node.type}>{node.text}</p>;
}

interface MetricPrimitiveProps {
  node: MetricNode;
  value: unknown;
  currency?: string | undefined;
}

export function MetricPrimitive({ node, value, currency }: MetricPrimitiveProps) {
  return (
    <section data-ui-id={node.id} data-ui-type={node.type} className="ui-metric">
      <span>{node.label}</span>
      <strong>{formatMetricValue(value, node.format, currency)}</strong>
    </section>
  );
}

export interface ChartRow {
  key: string;
  category: string;
  values: Array<{ label: string; value: string; numericValue: number | null }>;
}

export function ChartPrimitive({ node, rows }: { node: ChartNode; rows: ChartRow[] }) {
  const maximum = Math.max(
    0,
    ...rows.flatMap((row) => row.values.map((item) => item.numericValue ?? 0)),
  );

  return (
    <figure
      data-ui-id={node.id}
      data-ui-type={node.type}
      data-chart-type={node.chartType}
      className="ui-chart"
    >
      <figcaption>{node.title}</figcaption>
      <div role="img" aria-label={`${node.title}, gráfica ${node.chartType}`}>
        {rows.map((row) => (
          <section key={row.key} className="ui-chart__row">
            <span>{row.category}</span>
            {row.values.map((item) => (
              <div key={item.label} className="ui-chart__value">
                <span>{item.label}: {item.value}</span>
                {item.numericValue !== null && maximum > 0 ? (
                  <meter min={0} max={maximum} value={item.numericValue}>
                    {item.value}
                  </meter>
                ) : null}
              </div>
            ))}
          </section>
        ))}
      </div>
    </figure>
  );
}

export interface HeatmapRow {
  key: string;
  x: string;
  y: string;
  value: string;
}

export function HeatmapPrimitive({ node, rows }: { node: HeatmapNode; rows: HeatmapRow[] }) {
  return (
    <figure data-ui-id={node.id} data-ui-type={node.type} className="ui-chart">
      <figcaption>{node.title}</figcaption>
      <table aria-label={node.title}>
        <thead>
          <tr>
            <th>{node.xLabel}</th>
            <th>{node.yLabel}</th>
            <th>{node.valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.x}</td>
              <td>{row.y}</td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface TablePrimitiveProps {
  node: TableNode;
  rows: Array<{ key: string; values: string[] }>;
}

export function TablePrimitive({ node, rows }: TablePrimitiveProps) {
  return (
    <section data-ui-id={node.id} data-ui-type={node.type} className="ui-table">
      <h2>{node.title}</h2>
      <table>
        <thead>
          <tr>{node.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.values.map((value, index) => (
                <td key={node.columns[index]!.key}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AlertPrimitive({ node }: { node: AlertNode }) {
  const role = node.severity === "error" || node.severity === "warning"
    ? "alert"
    : "status";
  return (
    <aside
      data-ui-id={node.id}
      data-ui-type={node.type}
      data-severity={node.severity}
      role={role}
      className={`ui-alert ui-alert--${node.severity}`}
    >
      {node.text}
    </aside>
  );
}

export function toDisplayText(value: unknown): string {
  if (value === null) return "Sin datos";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return "Sin datos";
}

function formatMetricValue(
  value: unknown,
  format: MetricNode["format"],
  currency?: string,
): string {
  const text = toDisplayText(value);
  if (text === "Sin datos" || format === "text") return text;
  const formattedNumber = formatDecimalText(text);
  if (format === "percentage") return `${formattedNumber} %`;
  if (format === "currency" && currency && /^[A-Z]{3}$/.test(currency)) {
    return `${formattedNumber} ${currency}`;
  }
  return formattedNumber;
}

function formatDecimalText(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const groupedInteger = match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}${groupedInteger}${match[3] ?? ""}`;
}
