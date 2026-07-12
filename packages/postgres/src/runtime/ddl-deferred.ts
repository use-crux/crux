import { table } from './sql'

export const DEFERRED_POSTGRES_TABLES = [
  'defer_scopes',
  'defer_intents',
] as const

export const DEFERRED_REQUIRED_COLUMNS = {
  defer_scopes: [
    'namespace',
    'scope_id',
    'lease_token',
    'lease_expires_at',
    'finalization',
    'created_at',
    'updated_at',
  ],
  defer_intents: [
    'namespace',
    'scope_id',
    'intent_id',
    'work_id',
    'target_id',
    'input',
    'state',
    'created_at',
    'updated_at',
  ],
} as const

export const DEFERRED_REQUIRED_INDEXES = [
  'defer_scopes_terminal_lease_idx',
  'defer_intents_scope_state_idx',
] as const

/** Additive DDL for durable invocation scopes and staged named work. */
export function deferredDdlStatements(schema: string): readonly string[] {
  const scopes = table(schema, 'defer_scopes')
  const intents = table(schema, 'defer_intents')
  return [
    `CREATE TABLE IF NOT EXISTS ${scopes} (
      namespace text NOT NULL,
      scope_id text NOT NULL,
      lease_token text NOT NULL,
      lease_expires_at timestamptz NOT NULL,
      finalization jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, scope_id)
    )`,
    `CREATE TABLE IF NOT EXISTS ${intents} (
      namespace text NOT NULL,
      scope_id text NOT NULL,
      intent_id text NOT NULL,
      work_id text NOT NULL,
      target_id text NOT NULL,
      input jsonb NOT NULL,
      state text NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, intent_id)
    )`,
    `CREATE INDEX IF NOT EXISTS "defer_scopes_terminal_lease_idx"
      ON ${scopes} (namespace, (finalization->>'state'), lease_expires_at)`,
    `CREATE INDEX IF NOT EXISTS "defer_intents_scope_state_idx"
      ON ${intents} (namespace, scope_id, state)`,
  ]
}
