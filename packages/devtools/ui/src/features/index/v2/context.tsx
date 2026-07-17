/**
 * Index v2 index context.
 *
 * The design's renderers reach for module-global helpers (`INDEX_BY_ID`,
 * `indexChildrenOf`, `indexRelationsOf`, `indexLintsForDef`). Those globals are
 * derived from the live index here and threaded through context so every
 * hero / section / graph node can resolve related definitions without prop
 * drilling.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { IndexIndex } from "./adapt";

const IndexIndexContext = createContext<IndexIndex | null>(null);

export function IndexIndexProvider({
  index,
  children,
}: {
  index: IndexIndex;
  children: ReactNode;
}) {
  return (
    <IndexIndexContext.Provider value={index}>
      {children}
    </IndexIndexContext.Provider>
  );
}

export function useIndexIndex(): IndexIndex {
  const ctx = useContext(IndexIndexContext);
  if (!ctx)
    throw new Error("useIndexIndex must be used within a IndexIndexProvider");
  return ctx;
}

/**
 * Selection callback — lets deep detail components (hero reference cards,
 * relation rows, dependency cards) navigate to another definition without
 * prop-drilling. Defaults to a no-op so components render safely outside a
 * provider.
 */
export type SelectDefinition = (id: string) => void;

const IndexSelectContext = createContext<SelectDefinition>(() => {});

export function IndexSelectProvider({
  select,
  children,
}: {
  select: SelectDefinition;
  children: ReactNode;
}) {
  return (
    <IndexSelectContext.Provider value={select}>
      {children}
    </IndexSelectContext.Provider>
  );
}

export function useIndexSelect(): SelectDefinition {
  return useContext(IndexSelectContext);
}
