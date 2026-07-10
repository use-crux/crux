/**
 * Convex store document component manifest.
 *
 * Keep table, index, field, and marker identity in one Convex-free object so
 * the component schema, component functions, codec, server store, and React
 * reads cannot drift through duplicated string literals.
 *
 * @module
 */

/** Shared identity for the Crux Convex store document component. */
export const STORE_DOC_COMPONENT_SPEC = {
  table: 'memories',
  indexes: {
    byKey: 'by_key',
  },
  fields: {
    key: 'key',
    content: 'content',
    metadata: 'metadata',
    embedding: 'embedding',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    score: '_score',
    expiresAt: '_expiresAt',
    marker: '_cruxDoc',
  },
  defaultListLimit: 100,
  defaultVectorIndexName: 'by_embedding',
} as const

/** Name of the component table used for Crux store documents. */
export type StoreDocComponentTable = typeof STORE_DOC_COMPONENT_SPEC.table

/** Current metadata marker key used by Crux store documents. */
export type StoreDocFormatMarker = typeof STORE_DOC_COMPONENT_SPEC.fields.marker
