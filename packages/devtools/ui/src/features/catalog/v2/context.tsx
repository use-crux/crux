/**
 * Catalog v2 index context.
 *
 * The design's renderers reach for module-global helpers (`CAT_BY_ID`,
 * `catChildrenOf`, `catRelationsOf`, `catLintsForDef`). Those globals are
 * derived from the live catalog here and threaded through context so every
 * hero / section / graph node can resolve related definitions without prop
 * drilling.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { CatalogIndex } from './adapt'

const CatalogIndexContext = createContext<CatalogIndex | null>(null)

export function CatalogIndexProvider({ index, children }: { index: CatalogIndex; children: ReactNode }) {
  return <CatalogIndexContext.Provider value={index}>{children}</CatalogIndexContext.Provider>
}

export function useCatalogIndex(): CatalogIndex {
  const ctx = useContext(CatalogIndexContext)
  if (!ctx) throw new Error('useCatalogIndex must be used within a CatalogIndexProvider')
  return ctx
}

/**
 * Selection callback — lets deep detail components (hero reference cards,
 * relation rows, dependency cards) navigate to another definition without
 * prop-drilling. Defaults to a no-op so components render safely outside a
 * provider.
 */
export type SelectDefinition = (id: string) => void

const CatalogSelectContext = createContext<SelectDefinition>(() => {})

export function CatalogSelectProvider({ select, children }: { select: SelectDefinition; children: ReactNode }) {
  return <CatalogSelectContext.Provider value={select}>{children}</CatalogSelectContext.Provider>
}

export function useCatalogSelect(): SelectDefinition {
  return useContext(CatalogSelectContext)
}
