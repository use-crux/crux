/**
 * Catalog v2 — public surface.
 *
 * The master–detail Library/Catalog browser + architecture graph, wired to
 * the live `/api/catalog` read model. See `Catalog v2 — Implementation
 * Handover` and the Catalog Design System for the contract this implements.
 */

export { buildIndex, type CatalogIndex, type ViewDef } from './adapt'
export { CatalogIndexProvider, useCatalogIndex } from './context'
export { CatalogBrowser } from './browser'
export { CatalogDetail } from './detail'
export { CatalogGraph } from './graph'
export { IndexingStatus } from './kit'
