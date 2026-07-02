/**
 * `@use-crux/postgres/runtime` — Postgres Runtime Engine store adapter.
 *
 * Use this store with a runtime composer such as `node({ store:
 * postgres() })` today, and with `serverless({ store: postgres(), wake:
 * qstash() })` when the HTTP wake adapter lands.
 *
 * @module
 */

export { postgres } from './runtime/index'
export type {
  PostgresRuntimeStore,
  PostgresRuntimeStoreOptions,
  PostgresSetupOptions,
} from './runtime/index'
