/**
 * Provider-neutral serverless deferred-work host integrations.
 *
 * These helpers accept injected platform ports (`waitUntil`, `after`) and never
 * infer correctness from environment variable names. Framework packages such as
 * `@use-crux/next` bind a concrete SDK export and re-export a thin wrapper.
 *
 * @module
 */

export { SERVERLESS_DEFER_POLICY } from "./serverless/policy";
export type { DeferAfterPort, DeferWaitUntilPort } from "./serverless/ports";
export {
  withServerlessDefer,
  withWaitUntilDefer,
  withAfterDefer,
  withNamedOnlyDefer,
  type AfterDeferWrapOptions,
  type NamedOnlyDeferHostKind,
  type NamedOnlyDeferWrapOptions,
  type ServerlessDeferClassifyOutcome,
  type ServerlessDeferWrapOptions,
  type WaitUntilDeferWrapOptions,
} from "./serverless/wrap";
