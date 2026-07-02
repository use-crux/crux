import type { RuntimeSetupFinding } from '@use-crux/core/runtime'
import type { PgExecutor } from './sql'
import { advisoryLockKey, table } from './sql'

export const DEFAULT_POSTGRES_SCHEMA = 'crux_runtime'

const TABLES = [
  'work',
  'snapshots',
  'events',
  'waiters',
  'timers',
  'outbox',
  'idempotency',
  'leases',
  'idle_counters',
] as const

export type RuntimePostgresTable = (typeof TABLES)[number]

export function createSchemaSql(schema: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${quoteSchema(schema)}`
}

export function ddlStatements(schema: string): readonly string[] {
  const work = table(schema, 'work')
  const snapshots = table(schema, 'snapshots')
  const events = table(schema, 'events')
  const waiters = table(schema, 'waiters')
  const timers = table(schema, 'timers')
  const outbox = table(schema, 'outbox')
  const idempotency = table(schema, 'idempotency')
  const leases = table(schema, 'leases')
  const idleCounters = table(schema, 'idle_counters')

  return [
    createSchemaSql(schema),
    `CREATE TABLE IF NOT EXISTS ${work} (
      namespace text NOT NULL,
      work_id text NOT NULL,
      work jsonb NOT NULL,
      target_id text NOT NULL,
      status text NOT NULL,
      attempt integer NOT NULL,
      max_attempts integer NOT NULL,
      not_before timestamptz,
      idempotency_key text NOT NULL,
      idle_scope text,
      lease_token text,
      last_error jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, work_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${snapshots} (
      namespace text NOT NULL,
      flow_id text NOT NULL,
      work_id text NOT NULL,
      target_id text NOT NULL,
      status text NOT NULL,
      input jsonb NOT NULL,
      completed_steps jsonb NOT NULL,
      fingerprint jsonb NOT NULL,
      pending_suspends jsonb NOT NULL,
      scheduled_effects jsonb,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, flow_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${events} (
      event_id bigserial PRIMARY KEY,
      namespace text NOT NULL,
      name text NOT NULL,
      payload jsonb NOT NULL,
      duplicate_key text,
      appended_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ${waiters} (
      waiter_id text PRIMARY KEY,
      namespace text NOT NULL,
      event_name text NOT NULL,
      match jsonb NOT NULL,
      work_id text,
      work jsonb NOT NULL,
      timeout_at timestamptz,
      timer_id text,
      state text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${timers} (
      timer_id text PRIMARY KEY,
      namespace text NOT NULL,
      fire_at timestamptz NOT NULL,
      work_id text,
      waiter_id text,
      idle_scope text,
      work jsonb NOT NULL,
      idempotency_key text,
      state text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${outbox} (
      outbox_id text PRIMARY KEY,
      namespace text NOT NULL,
      envelope jsonb NOT NULL,
      state text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at timestamptz NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${idempotency} (
      namespace text NOT NULL,
      key text NOT NULL,
      completed_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, key)
    )`,
    `CREATE TABLE IF NOT EXISTS ${leases} (
      resource text PRIMARY KEY,
      token text NOT NULL,
      expires_at timestamptz NOT NULL,
      owner_id text
    )`,
    `CREATE TABLE IF NOT EXISTS ${idleCounters} (
      namespace text NOT NULL,
      scope text NOT NULL,
      count integer NOT NULL,
      PRIMARY KEY (namespace, scope)
    )`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_event_id_idx')}
      ON ${events} (namespace, event_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_duplicate_key_idx')}
      ON ${events} (namespace, duplicate_key) WHERE duplicate_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_armed_event_idx')}
      ON ${waiters} (namespace, event_name) WHERE state = 'armed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_work_id_idx')}
      ON ${waiters} (work_id)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_timeout_armed_idx')}
      ON ${waiters} (timeout_at) WHERE state = 'armed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'work_status_not_before_idx')}
      ON ${work} (namespace, status, not_before)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'work_status_updated_at_idx')}
      ON ${work} (namespace, status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_scheduled_fire_at_idx')}
      ON ${timers} (fire_at) WHERE state = 'scheduled'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_work_id_idx')}
      ON ${timers} (work_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_namespace_idempotency_key_idx')}
      ON ${timers} (namespace, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'outbox_pending_next_attempt_idx')}
      ON ${outbox} (next_attempt_at) WHERE state = 'pending'`,
  ]
}

export async function applyDdl(
  client: PgExecutor,
  schema: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [
    advisoryLockKey(schema),
  ])
  for (const statement of ddlStatements(schema)) {
    await client.query(statement)
  }
}

export async function checkDdl(
  client: PgExecutor,
  schema: string,
): Promise<readonly RuntimeSetupFinding[]> {
  const tableResult = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'`,
    [schema],
  )
  const existingTables = new Set(tableResult.rows.map((row) => row.table_name))
  const missingTables = TABLES.filter((name) => !existingTables.has(name))

  const indexResult = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1`,
    [schema],
  )
  const existingIndexes = new Set(indexResult.rows.map((row) => row.indexname))
  const requiredIndexes = [
    'events_namespace_event_id_idx',
    'events_namespace_duplicate_key_idx',
    'waiters_armed_event_idx',
    'waiters_work_id_idx',
    'waiters_timeout_armed_idx',
    'work_status_not_before_idx',
    'work_status_updated_at_idx',
    'timers_scheduled_fire_at_idx',
    'timers_work_id_idx',
    'timers_namespace_idempotency_key_idx',
    'outbox_pending_next_attempt_idx',
  ]
  const missingIndexes = requiredIndexes.filter(
    (name) => !existingIndexes.has(name),
  )

  return [
    ...missingTables.map((name) =>
      setupFinding(
        `schema ${schema} table ${name}`,
        `Postgres schema ${schema} is missing Crux runtime table ${name}.`,
        schema,
      ),
    ),
    ...missingIndexes.map((name) =>
      setupFinding(
        `schema ${schema} index ${name}`,
        `Postgres schema ${schema} is missing Crux runtime index ${name}.`,
        schema,
      ),
    ),
  ]
}

function setupFinding(
  resource: string,
  message: string,
  schema: string,
): RuntimeSetupFinding {
  return {
    code: 'SETUP_REQUIRED',
    resource,
    message,
    remediation: `Run crux runtime setup --apply or call postgres({ schema: ${JSON.stringify(schema)} }).setup.apply().`,
  }
}

function quoteSchema(schema: string): string {
  return `"${schema.replaceAll('"', '""')}"`
}

function quoteIndex(_schema: string, name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
