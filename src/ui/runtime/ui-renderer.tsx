import { type ReactElement } from "react";
import {
  parseUiDocument,
  readUiDataPath,
  resolveUiDataReference,
  type UiDataSource,
  type UiNode,
} from "../dsl/ui.schema.js";
import { type UiInteractionEvent } from "../interaction/ui-event.schema.js";
import {
  AlertPrimitive,
  ChartPrimitive,
  HeatmapPrimitive,
  MetricPrimitive,
  TablePrimitive,
  TextPrimitive,
  toDisplayText,
  type ChartRow,
  type HeatmapRow,
} from "./primitives/content-primitives.js";
import {
  ButtonPrimitive,
  FiltersPrimitive,
  FormPrimitive,
  SliderPrimitive,
} from "./primitives/interactive-primitives.js";
import {
  CardPrimitive,
  DashboardPrimitive,
  GridPrimitive,
  StackPrimitive,
  TabsPrimitive,
} from "./primitives/layout-primitives.js";

export function createFinancialUiElement(
  input: unknown,
  dataSources: UiDataSource[],
  options: UiRuntimeOptions = {},
): ReactElement {
  const document = parseUiDocument(input, dataSources);
  return <UiNodeRenderer node={document.root} dataSources={dataSources} options={options} />;
}

export interface UiRuntimeOptions {
  onInteraction?: ((event: UiInteractionEvent) => void) | undefined;
  selectedTabs?: Readonly<Record<string, string>> | undefined;
}

interface UiNodeRendererProps {
  node: UiNode;
  dataSources: UiDataSource[];
  options: UiRuntimeOptions;
}

function UiNodeRenderer({ node, dataSources, options }: UiNodeRendererProps): ReactElement {
  switch (node.type) {
    case "dashboard":
      return (
        <DashboardPrimitive node={node}>
          {renderChildren(node.children, dataSources, options)}
        </DashboardPrimitive>
      );
    case "stack":
      return (
        <StackPrimitive node={node}>
          {renderChildren(node.children, dataSources, options)}
        </StackPrimitive>
      );
    case "grid":
      return (
        <GridPrimitive node={node}>
          {renderChildren(node.children, dataSources, options)}
        </GridPrimitive>
      );
    case "card":
      return (
        <CardPrimitive node={node}>
          {renderChildren(node.children, dataSources, options)}
        </CardPrimitive>
      );
    case "tabs":
      return (
        <TabsPrimitive
          node={node}
          panels={node.tabs.map((tab) => renderChildren(tab.children, dataSources, options))}
          selectedTabId={options.selectedTabs?.[node.id]}
          onInteraction={options.onInteraction}
        />
      );
    case "text":
      return <TextPrimitive node={node} />;
    case "metric":
      return (
        <MetricPrimitive
          node={node}
          value={resolveUiDataReference(node.value, dataSources)}
          currency={resolveCurrency(node, dataSources)}
        />
      );
    case "chart":
      return <ChartPrimitive node={node} rows={createChartRows(node, dataSources)} />;
    case "heatmap":
      return <HeatmapPrimitive node={node} rows={createHeatmapRows(node, dataSources)} />;
    case "table":
      return <TablePrimitive node={node} rows={createTableRows(node, dataSources)} />;
    case "form":
      return <FormPrimitive node={node} onInteraction={options.onInteraction} />;
    case "filters":
      return <FiltersPrimitive node={node} onInteraction={options.onInteraction} />;
    case "alert":
      return <AlertPrimitive node={node} />;
    case "button":
      return <ButtonPrimitive node={node} onInteraction={options.onInteraction} />;
    case "slider":
      return <SliderPrimitive node={node} onInteraction={options.onInteraction} />;
    default:
      return assertNever(node);
  }
}

function renderChildren(
  children: UiNode[],
  dataSources: UiDataSource[],
  options: UiRuntimeOptions,
): ReactElement[] {
  return children.map((child) => (
    <UiNodeRenderer key={child.id} node={child} dataSources={dataSources} options={options} />
  ));
}

function resolveCurrency(
  node: Extract<UiNode, { type: "metric" }>,
  dataSources: UiDataSource[],
): string | undefined {
  if (!node.currencyPath) return undefined;
  const currency = resolveUiDataReference({
    sourceId: node.value.sourceId,
    path: node.currencyPath,
  }, dataSources);
  return typeof currency === "string" ? currency : undefined;
}

function createChartRows(
  node: Extract<UiNode, { type: "chart" }>,
  dataSources: UiDataSource[],
): ChartRow[] {
  const rows = resolveUiDataReference(node.data, dataSources) as unknown[];
  return rows.map((row, rowIndex) => {
    const category = toDisplayText(readUiDataPath(row, node.categoryKey));
    return {
      key: `${node.id}-${category}-${rowIndex}`,
      category,
      values: node.series.map((series) => {
        const value = readUiDataPath(row, series.key);
        return {
          label: series.label,
          value: toDisplayText(value),
          numericValue: toChartNumber(value),
        };
      }),
    };
  });
}

function createTableRows(
  node: Extract<UiNode, { type: "table" }>,
  dataSources: UiDataSource[],
) {
  const rows = resolveUiDataReference(node.data, dataSources) as unknown[];
  return rows.slice(0, node.maxRows).map((row, rowIndex) => ({
    key: `${node.id}-row-${rowIndex}`,
    values: node.columns.map((column) => toDisplayText(readUiDataPath(row, column.key))),
  }));
}

function createHeatmapRows(
  node: Extract<UiNode, { type: "heatmap" }>,
  dataSources: UiDataSource[],
): HeatmapRow[] {
  const rows = resolveUiDataReference(node.data, dataSources) as unknown[];
  return rows.map((row, rowIndex) => ({
    key: `${node.id}-cell-${rowIndex}`,
    x: toDisplayText(readUiDataPath(row, node.xKey)),
    y: toDisplayText(readUiDataPath(row, node.yKey)),
    value: toDisplayText(readUiDataPath(row, node.valueKey)),
  }));
}

function toChartNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : null;
}

function assertNever(value: never): never {
  throw new Error(`Tipo de UI no soportado: ${String(value)}`);
}
