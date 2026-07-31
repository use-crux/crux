/**
 * Internal Convex store document boundary.
 *
 * This facade keeps adapter imports small while the implementation is split by
 * concern: structural types, document codec, and Storage Beta adapters.
 *
 * @module
 */

export * from './store-doc/types'
export * from './store-doc/manifest'
export * from './store-doc/codec'
export * from './store-doc/storage'
export * from './store-doc/version'
