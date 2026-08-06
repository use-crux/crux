import type { RuntimeSetupFinding } from '@use-crux/core/runtime'
import type { PgExecutor } from './sql'
import { advisoryLockKey, table } from './sql'
import {
  DEFERRED_POSTGRES_TABLES,
  DEFERRED_REQUIRED_COLUMNS,
  DEFERRED_REQUIRED_INDEXES,
  deferredDdlStatements,
} from './ddl-deferred'
import {
  EFFECTS_POSTGRES_TABLES,
  EFFECTS_REQUIRED_COLUMNS,
  EFFECTS_REQUIRED_INDEXES,
  effectsDdlStatements,
} from './ddl-effects'
import {
  SESSION_POSTGRES_TABLES,
  SESSION_REQUIRED_COLUMNS,
  SESSION_REQUIRED_INDEXES,
  sessionDdlStatements,
} from './ddl-sessions'
import {
  TRANSPORT_POSTGRES_TABLES,
  TRANSPORT_REQUIRED_COLUMNS,
  TRANSPORT_REQUIRED_INDEXES,
  transportDdlStatements,
} from './ddl-transport'

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
  'results',
  ...DEFERRED_POSTGRES_TABLES,
  ...EFFECTS_POSTGRES_TABLES,
  ...SESSION_POSTGRES_TABLES,
  ...TRANSPORT_POSTGRES_TABLES,
] as const

export type RuntimePostgresTable = (typeof TABLES)[number]

export const REQUIRED_COLUMNS: Readonly<
  Record<RuntimePostgresTable, readonly string[]>
> = {
  work: [
    'namespace',
    'work_id',
    'work',
    'target_id',
    'status',
    'attempt',
    'max_attempts',
    'not_before',
    'idempotency_key',
    'idle_scope',
    'lease_token',
    'last_error',
    'result_ref',
    'application',
    'created_at',
    'updated_at',
  ],
  snapshots: [
    'namespace',
    'flow_id',
    'work_id',
    'target_id',
    'status',
    'effects',
    'definition',
    'result_obligation',
    'input',
    'input_digest',
    'continuation',
    'completed_steps',
    'fingerprint',
    'pending_suspends',
    'delivered_suspends',
    'scheduled_work',
    'updated_at',
  ],
  events: [
    'event_id',
    'namespace',
    'name',
    'payload',
    'duplicate_key',
    'appended_at',
  ],
  waiters: [
    'waiter_id',
    'namespace',
    'event_name',
    'match',
    'work_id',
    'work',
    'timeout_at',
    'timer_id',
    'state',
    'settled_at',
  ],
  timers: [
    'timer_id',
    'namespace',
    'fire_at',
    'work_id',
    'waiter_id',
    'idle_scope',
    'work',
    'idempotency_key',
    'state',
    'settled_at',
  ],
  outbox: [
    'outbox_id',
    'namespace',
    'work_id',
    'envelope',
    'state',
    'attempts',
    'next_attempt_at',
    'confirmed_at',
  ],
  idempotency: ['namespace', 'key', 'completed_at'],
  leases: ['resource', 'token', 'expires_at', 'owner_id'],
  idle_counters: ['namespace', 'scope', 'count'],
  results: [
    'location',
    'namespace',
    'sha256',
    'size',
    'media_type',
    'payload',
    'created_at',
  ],
  ...DEFERRED_REQUIRED_COLUMNS,
  ...EFFECTS_REQUIRED_COLUMNS,
  ...SESSION_REQUIRED_COLUMNS,
  ...TRANSPORT_REQUIRED_COLUMNS,
}

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
  const results = table(schema, 'results')

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
      result_ref jsonb,
      application jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, work_id)
    )`,
    `ALTER TABLE ${work}
      ADD COLUMN IF NOT EXISTS result_ref jsonb`,
    `ALTER TABLE ${work}
      ADD COLUMN IF NOT EXISTS application jsonb`,
    `CREATE TABLE IF NOT EXISTS ${snapshots} (
      namespace text NOT NULL,
      flow_id text NOT NULL,
      work_id text NOT NULL,
      target_id text NOT NULL,
      status text NOT NULL,
      effects jsonb,
      definition jsonb,
      result_obligation jsonb,
      input jsonb NOT NULL,
      input_digest text,
      continuation jsonb,
      completed_steps jsonb NOT NULL,
	      fingerprint jsonb NOT NULL,
	      pending_suspends jsonb NOT NULL,
	      delivered_suspends jsonb,
	      scheduled_work jsonb,
	      updated_at timestamptz NOT NULL,
	      PRIMARY KEY (namespace, flow_id)
	    )`,
    `ALTER TABLE ${snapshots}
	      ADD COLUMN IF NOT EXISTS effects jsonb`,
    `ALTER TABLE ${snapshots}
      ADD COLUMN IF NOT EXISTS definition jsonb`,
    `ALTER TABLE ${snapshots}
      ADD COLUMN IF NOT EXISTS result_obligation jsonb`,
    `ALTER TABLE ${snapshots}
      ADD COLUMN IF NOT EXISTS input_digest text`,
    `ALTER TABLE ${snapshots}
      ADD COLUMN IF NOT EXISTS continuation jsonb`,
    `ALTER TABLE ${snapshots}
	      ADD COLUMN IF NOT EXISTS scheduled_work jsonb`,
    `ALTER TABLE ${snapshots}
	      ADD COLUMN IF NOT EXISTS delivered_suspends jsonb`,
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
      state text NOT NULL,
      settled_at timestamptz
    )`,
    `ALTER TABLE ${waiters}
      ADD COLUMN IF NOT EXISTS settled_at timestamptz`,
    `CREATE TABLE IF NOT EXISTS ${timers} (
      timer_id text PRIMARY KEY,
      namespace text NOT NULL,
      fire_at timestamptz NOT NULL,
      work_id text,
      waiter_id text,
      idle_scope text,
      work jsonb NOT NULL,
      idempotency_key text,
      state text NOT NULL,
      settled_at timestamptz
    )`,
    `ALTER TABLE ${timers}
      ADD COLUMN IF NOT EXISTS settled_at timestamptz`,
    `CREATE TABLE IF NOT EXISTS ${outbox} (
      outbox_id text PRIMARY KEY,
      namespace text NOT NULL,
      work_id text,
      envelope jsonb NOT NULL,
      state text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at timestamptz NOT NULL,
      confirmed_at timestamptz
    )`,
    `ALTER TABLE ${outbox}
      ADD COLUMN IF NOT EXISTS work_id text`,
    `ALTER TABLE ${outbox}
      ADD COLUMN IF NOT EXISTS confirmed_at timestamptz`,
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
    `CREATE TABLE IF NOT EXISTS ${results} (
      location text PRIMARY KEY,
      namespace text NOT NULL,
      sha256 text NOT NULL,
      size integer NOT NULL,
      media_type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL
    )`,
    ...deferredDdlStatements(schema),
    ...effectsDdlStatements(schema),
    ...sessionDdlStatements(schema),
    ...transportDdlStatements(schema),
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_event_id_idx')}
      ON ${events} (namespace, event_id)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_name_event_id_idx')}
      ON ${events} (namespace, name, event_id)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_appended_at_idx')}
      ON ${events} (namespace, appended_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIndex(schema, 'events_namespace_duplicate_key_idx')}
      ON ${events} (namespace, duplicate_key) WHERE duplicate_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_armed_event_idx')}
      ON ${waiters} (namespace, event_name) WHERE state = 'armed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_work_id_idx')}
      ON ${waiters} (work_id)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_timeout_armed_idx')}
      ON ${waiters} (timeout_at) WHERE state = 'armed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'waiters_settled_at_idx')}
      ON ${waiters} (namespace, settled_at) WHERE state <> 'armed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'work_status_not_before_idx')}
      ON ${work} (namespace, status, not_before)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'work_status_updated_at_idx')}
      ON ${work} (namespace, status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'snapshots_status_updated_at_idx')}
      ON ${snapshots} (namespace, status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_scheduled_fire_at_idx')}
      ON ${timers} (fire_at) WHERE state = 'scheduled'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_work_id_idx')}
      ON ${timers} (work_id)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_settled_at_idx')}
      ON ${timers} (namespace, settled_at) WHERE state IN ('fired', 'cancelled')`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIndex(schema, 'timers_namespace_idempotency_key_idx')}
      ON ${timers} (namespace, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'outbox_pending_next_attempt_idx')}
      ON ${outbox} (next_attempt_at) WHERE state = 'pending'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'outbox_claimable_next_attempt_idx')}
      ON ${outbox} (namespace, next_attempt_at) WHERE state <> 'confirmed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'outbox_work_pending_idx')}
      ON ${outbox} (work_id) WHERE state = 'pending'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'outbox_confirmed_at_idx')}
      ON ${outbox} (namespace, confirmed_at) WHERE state = 'confirmed'`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'idempotency_completed_at_idx')}
      ON ${idempotency} (namespace, completed_at)`,
    `CREATE INDEX IF NOT EXISTS ${quoteIndex(schema, 'results_namespace_created_at_idx')}
      ON ${results} (namespace, created_at)`,
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

  const columnResult = await client.query<{
    table_name: RuntimePostgresTable
    column_name: string
  }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])`,
    [schema, TABLES],
  )
  const columnsByTable = new Map<RuntimePostgresTable, Set<string>>()
  for (const row of columnResult.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>()
    columns.add(row.column_name)
    columnsByTable.set(row.table_name, columns)
  }
  const missingColumns = TABLES.flatMap((tableName) => {
    if (missingTables.includes(tableName)) return []
    const columns = columnsByTable.get(tableName) ?? new Set<string>()
    return REQUIRED_COLUMNS[tableName]
      .filter((columnName) => !columns.has(columnName))
      .map((columnName) => ({ tableName, columnName }))
  })

  const indexResult = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1`,
    [schema],
  )
  const existingIndexes = new Set(indexResult.rows.map((row) => row.indexname))
  const requiredIndexes = [
    'events_namespace_event_id_idx',
    'events_namespace_name_event_id_idx',
    'events_namespace_appended_at_idx',
    'events_namespace_duplicate_key_idx',
    'waiters_armed_event_idx',
    'waiters_work_id_idx',
    'waiters_timeout_armed_idx',
    'waiters_settled_at_idx',
    'work_status_not_before_idx',
    'work_status_updated_at_idx',
    'snapshots_status_updated_at_idx',
    'timers_scheduled_fire_at_idx',
    'timers_work_id_idx',
    'timers_settled_at_idx',
    'timers_namespace_idempotency_key_idx',
    'outbox_pending_next_attempt_idx',
    'outbox_claimable_next_attempt_idx',
    'outbox_work_pending_idx',
    'outbox_confirmed_at_idx',
    'idempotency_completed_at_idx',
    'results_namespace_created_at_idx',
    ...DEFERRED_REQUIRED_INDEXES,
    ...EFFECTS_REQUIRED_INDEXES,
    ...SESSION_REQUIRED_INDEXES,
    ...TRANSPORT_REQUIRED_INDEXES,
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
    ...missingColumns.map(({ tableName, columnName }) =>
      setupFinding(
        `schema ${schema} table ${tableName} column ${columnName}`,
        `Postgres schema ${schema} is missing Crux runtime column ${tableName}.${columnName}.`,
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
    remediation: `Run crux setup --apply or call postgres({ schema: ${JSON.stringify(schema)} }).setup.apply().`,
  }
}

function quoteSchema(schema: string): string {
  return `"${schema.replaceAll('"', '""')}"`
}

function quoteIndex(_schema: string, name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
