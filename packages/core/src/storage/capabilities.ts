import { StorageError } from './errors'
import type { SearchStoreCapabilities, SearchStoreCapabilityConfig, SearchLegKind } from './types'

const SEARCH_LEG_KINDS = ['dense', 'sparse', 'lexical'] as const satisfies readonly SearchLegKind[]

/** Normalize and validate advertised SearchStore capabilities. */
export function searchStoreCapabilities(config: SearchStoreCapabilityConfig): SearchStoreCapabilities {
  const legs = Object.freeze({
    dense: config.legs.dense === true,
    sparse: config.legs.sparse === true,
    lexical: config.legs.lexical === true,
  })
  const enabledLegCount = SEARCH_LEG_KINDS.filter((kind) => legs[kind]).length
  const fusion = config.fusion ?? (enabledLegCount >= 2 ? ['rrf'] : [])
  if (fusion.some((strategy) => strategy !== 'rrf')) {
    throw new StorageError('invalid_value', 'SearchStore fusion supports only rrf.')
  }
  if (fusion.includes('rrf') && enabledLegCount < 2) {
    throw new StorageError('invalid_value', 'SearchStore RRF fusion requires at least two enabled legs.')
  }
  return Object.freeze({
    legs,
    fusion: Object.freeze([...fusion]),
    filter: config.filter ?? false,
    consistency: config.consistency ?? 'strong',
  })
}
