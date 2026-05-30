/**
 * `@crux/core/adapter` — Provider adapter abstraction.
 *
 * Shared infrastructure for building AI provider adapters.
 * The `adapter()` factory handles tool loops, prompt resolution,
 * settings mapping, and agent compositions. Provider-specific adapters
 * implement `AdapterSpec` and get all shared orchestration for free.
 *
 * @module
 */

// Core types
export type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry, StatusDelta } from './types'

// Adapter specification interface
export type { AdapterSpec } from './spec'

// Factory + result/option types
export { adapter } from './define-adapter'
export type { CruxAdapter, AdapterGenerateOptions, AdapterStreamOptions, AdapterGenerateResult } from './define-adapter'
