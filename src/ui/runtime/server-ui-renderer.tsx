import { renderToStaticMarkup } from "react-dom/server";
import {
  currentTraceContext,
  runWithTraceContext,
  telemetry,
  type TraceContext,
} from "../../observability/telemetry.js";
import { type UiDataSource } from "../dsl/ui.schema.js";
import { createFinancialUiElement, type UiRuntimeOptions } from "./ui-renderer.js";

export interface ServerUiRenderOptions extends UiRuntimeOptions {
  traceContext?: TraceContext;
}

export function renderFinancialUiToHtml(
  input: unknown,
  dataSources: UiDataSource[],
  options: ServerUiRenderOptions = {},
): string {
  const context = options.traceContext ?? currentTraceContext();
  return runWithTraceContext(context, () => {
    const span = telemetry.startSpan({ component: "ui", operation: "render" });
    try {
      const html = renderToStaticMarkup(createFinancialUiElement(input, dataSources, options));
      span.complete({ outputBytes: Buffer.byteLength(html, "utf8") });
      return html;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  });
}
