import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'

/** PostgreSQL implementation target for Core's normalized Session port. */
export type PostgresSessionStore = NonNullable<
  RuntimeStoreTransaction['sessions']
>

export type RuntimeSessionRecord = NonNullable<
  Awaited<ReturnType<PostgresSessionStore['get']>>
>

export type RuntimeSessionInputRecord = NonNullable<
  Awaited<ReturnType<PostgresSessionStore['getInput']>>
>

export type RuntimeSessionPreparedExecution = NonNullable<
  Awaited<ReturnType<PostgresSessionStore['getPreparedExecution']>>
>

export type RuntimeSessionActivation = NonNullable<
  RuntimeSessionRecord['activation']
>
