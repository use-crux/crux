/**
 * `@use-crux/postgres/runtime` — Postgres Runtime Engine store adapter.
 *
 * Use this store with a runtime composer such as `node({ store:
 * postgres() })`, or with `serverless({ store: postgres(), wake:
 * qstash() })` for serverless HTTP wake deployments.
 *
 * @module
 */

export { postgres } from './runtime/index'
export type {
  PostgresRuntimeStore,
  PostgresRuntimeStoreOptions,
  PostgresSetupOptions,
} from './runtime/index'
