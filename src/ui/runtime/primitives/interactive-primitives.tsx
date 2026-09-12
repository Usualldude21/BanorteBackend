import { type FormEvent } from "react";
import { type UiNode } from "../../dsl/ui.schema.js";
import { type UiInteractionEvent } from "../../interaction/ui-event.schema.js";

type FormNode = Extract<UiNode, { type: "form" }>;
type FilterNode = Extract<UiNode, { type: "filters" }>;
type ButtonNode = Extract<UiNode, { type: "button" }>;
type SliderNode = Extract<UiNode, { type: "slider" }>;
type FormField = FormNode["fields"][number];
type FilterField = FilterNode["fields"][number];

interface InteractiveNodeProps<TNode> {
  node: TNode;
  onInteraction: ((event: UiInteractionEvent) => void) | undefined;
}

export function FormPrimitive({ node, onInteraction }: InteractiveNodeProps<FormNode>) {
  return (
    <form
      id={node.id}
      data-ui-id={node.id}
      data-ui-type={node.type}
      className="ui-form"
      onSubmit={(event) => submitForm(event, node, onInteraction)}
    >
      <fieldset>
        <legend>{node.title}</legend>
        {node.fields.map((field) => <FormFieldPrimitive key={field.id} field={field} />)}
      </fieldset>
      <button type="submit">{node.submitLabel}</button>
    </form>
  );
}

function FormFieldPrimitive({ field }: { field: FormField }) {
  if (field.type === "select") {
    return (
      <label htmlFor={field.id}>
        {field.label}
        <select id={field.id} name={field.id}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label htmlFor={field.id}>
      {field.label}
      <input
        id={field.id}
        name={field.id}
        type={field.type}
        placeholder={field.type === "text" ? field.placeholder : undefined}
        maxLength={field.type === "text" ? field.maxLength : undefined}
      />
    </label>
  );
}

export function FiltersPrimitive({ node, onInteraction }: InteractiveNodeProps<FilterNode>) {
  return (
    <form
      id={node.id}
      data-ui-id={node.id}
      data-ui-type={node.type}
      className="ui-filters"
      onSubmit={(event) => submitFilters(event, node, onInteraction)}
    >
      {node.fields.map((field) => <FilterFieldPrimitive key={field.id} field={field} />)}
      <button type="submit">Aplicar filtros</button>
    </form>
  );
}

function FilterFieldPrimitive({ field }: { field: FilterField }) {
  if (field.type === "select") {
    return (
      <label htmlFor={field.id}>
        {field.label}
        <select id={field.id} name={field.id}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <fieldset>
      <legend>{field.label}</legend>
      <input id={`${field.id}-start`} name={`${field.id}.start`} type="date" />
      <input id={`${field.id}-end`} name={`${field.id}.end`} type="date" />
    </fieldset>
  );
}

export function ButtonPrimitive({ node, onInteraction }: InteractiveNodeProps<ButtonNode>) {
  const formId = node.action.type === "apply-filters"
    ? node.action.filterId
    : node.action.type === "submit-form" ? node.action.formId : undefined;
  return (
    <button
      data-ui-id={node.id}
      data-ui-type={node.type}
      data-action={node.action.type}
      type={formId ? "submit" : "button"}
      form={formId}
      onClick={formId ? undefined : () => activateButton(node, onInteraction)}
    >
      {node.label}
    </button>
  );
}

export function SliderPrimitive({ node, onInteraction }: InteractiveNodeProps<SliderNode>) {
  return (
    <label htmlFor={node.id} data-ui-id={node.id} data-ui-type={node.type}>
      {node.label}
      <input
        id={node.id}
        type="range"
        min={node.min}
        max={node.max}
        step={node.step}
        defaultValue={node.initialValue}
        onChange={(event) => onInteraction?.({
          type: "change-slider",
          sourceId: node.id,
          value: Number(event.currentTarget.value),
        })}
      />
    </label>
  );
}

function submitForm(
  event: FormEvent<HTMLFormElement>,
  node: FormNode,
  onInteraction?: (event: UiInteractionEvent) => void,
): void {
  event.preventDefault();
  onInteraction?.({
    type: "submit-form",
    sourceId: node.id,
    values: readValues(event.currentTarget, node.fields.map((field) => field.id)),
  });
}

function submitFilters(
  event: FormEvent<HTMLFormElement>,
  node: FilterNode,
  onInteraction?: (event: UiInteractionEvent) => void,
): void {
  event.preventDefault();
  const fieldNames = node.fields.flatMap((field) => (
    field.type === "date-range" ? [`${field.id}.start`, `${field.id}.end`] : [field.id]
  ));
  onInteraction?.({
    type: "apply-filters",
    sourceId: node.id,
    values: readValues(event.currentTarget, fieldNames),
  });
}

function readValues(form: HTMLFormElement, fieldNames: string[]): Record<string, string> {
  const data = new FormData(form);
  return Object.fromEntries(fieldNames.map((fieldName) => {
    const value = data.get(fieldName);
    return [fieldName, typeof value === "string" ? value : ""];
  }));
}

function activateButton(
  node: ButtonNode,
  onInteraction?: (event: UiInteractionEvent) => void,
): void {
  if (!onInteraction) return;
  if (node.action.type === "refresh") {
    onInteraction({ type: "refresh", sourceId: node.id });
    return;
  }
  if (node.action.type === "select-tab") {
    onInteraction({
      type: "select-tab",
      sourceId: node.action.tabsId,
      tabId: node.action.tabId,
    });
  }
}
