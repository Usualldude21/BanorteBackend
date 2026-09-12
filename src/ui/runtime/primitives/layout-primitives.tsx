import { type ReactNode } from "react";
import { type UiNode } from "../../dsl/ui.schema.js";
import { type UiInteractionEvent } from "../../interaction/ui-event.schema.js";

type DashboardNode = Extract<UiNode, { type: "dashboard" }>;
type StackNode = Extract<UiNode, { type: "stack" }>;
type GridNode = Extract<UiNode, { type: "grid" }>;
type CardNode = Extract<UiNode, { type: "card" }>;
type TabsNode = Extract<UiNode, { type: "tabs" }>;

interface NodeChildrenProps<TNode> {
  node: TNode;
  children: ReactNode;
}

export function DashboardPrimitive({ node, children }: NodeChildrenProps<DashboardNode>) {
  return (
    <main data-ui-id={node.id} data-ui-type={node.type} className="financial-dashboard">
      <h1>{node.title}</h1>
      {children}
    </main>
  );
}

export function StackPrimitive({ node, children }: NodeChildrenProps<StackNode>) {
  return (
    <section
      data-ui-id={node.id}
      data-ui-type={node.type}
      data-direction={node.direction}
      className={`ui-stack ui-stack--${node.direction}`}
    >
      {children}
    </section>
  );
}

export function GridPrimitive({ node, children }: NodeChildrenProps<GridNode>) {
  return (
    <section
      data-ui-id={node.id}
      data-ui-type={node.type}
      data-columns={node.columnCount}
      className={`ui-grid ui-grid--${node.columnCount}`}
    >
      {children}
    </section>
  );
}

export function CardPrimitive({ node, children }: NodeChildrenProps<CardNode>) {
  return (
    <article data-ui-id={node.id} data-ui-type={node.type} className="ui-card">
      {node.title ? <h2>{node.title}</h2> : null}
      {children}
    </article>
  );
}

interface TabsPrimitiveProps {
  node: TabsNode;
  panels: ReactNode[];
  selectedTabId: string | undefined;
  onInteraction: ((event: UiInteractionEvent) => void) | undefined;
}

export function TabsPrimitive({
  node,
  panels,
  selectedTabId,
  onInteraction,
}: TabsPrimitiveProps) {
  const activeTabId = node.tabs.some((tab) => tab.id === selectedTabId)
    ? selectedTabId
    : node.tabs[0]?.id;
  return (
    <section data-ui-id={node.id} data-ui-type={node.type} className="ui-tabs">
      <div role="tablist" aria-label="Secciones">
        {node.tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${node.id}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-controls={`${node.id}-${tab.id}-panel`}
            aria-selected={tab.id === activeTabId}
            onClick={() => onInteraction?.({
              type: "select-tab",
              sourceId: node.id,
              tabId: tab.id,
            })}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {node.tabs.map((tab, index) => (
        <section
          key={tab.id}
          id={`${node.id}-${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${node.id}-${tab.id}-tab`}
          hidden={tab.id !== activeTabId}
        >
          {panels[index]}
        </section>
      ))}
    </section>
  );
}
