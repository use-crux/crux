/**
 * Convex runtime profile for `@crux/core` context primitives.
 *
 * Context APIs are identical re-exports today. Keep this subpath mirrored so
 * Convex code can import from one package profile.
 *
 * @module
 */

export { context, createContexts, match, when } from '@crux/core'
export type {
  ConditionalContext,
  Context,
  ContextDef,
  ContextEntry,
  ContextSystemArg,
  ContextTree,
  ContextTreeResult,
  DeepReadonly,
  MatchSpec,
} from '@crux/core'
