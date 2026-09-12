import {
  createFinancialUiElement,
  type UiRuntimeOptions,
} from "../runtime/ui-renderer.js";
import { type UiStreamState } from "./ui-stream-state.js";

interface StreamingFinancialUiProps extends UiRuntimeOptions {
  state: UiStreamState;
}

export function StreamingFinancialUi({
  state,
  onInteraction,
  selectedTabs,
}: StreamingFinancialUiProps) {
  const content = state.ui
    ? createFinancialUiElement(state.ui, state.dataSources, { onInteraction, selectedTabs })
    : null;

  return (
    <section
      className="financial-ui-stream"
      data-stream-phase={state.phase}
      aria-busy={state.phase === "loading" || state.phase === "partial"}
    >
      {state.message ? (
        <p role={state.phase === "error" ? "alert" : "status"}>{state.message}</p>
      ) : null}
      {content}
    </section>
  );
}
