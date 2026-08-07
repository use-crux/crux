import { table } from './sql'

export const SESSION_POSTGRES_TABLES: readonly [
  'sessions',
  'session_inputs',
  'session_subscriptions',
] = ['sessions', 'session_inputs', 'session_subscriptions']

export const SESSION_REQUIRED_COLUMNS: Readonly<
  Record<(typeof SESSION_POSTGRES_TABLES)[number], readonly string[]>
> = {
  sessions: [
    'namespace',
    'session_id',
    'key_hash',
    'target_id',
    'target_kind',
    'thread_id',
    'model',
    'definition',
    'state',
    'accepted_cursor',
    'processed_cursor',
    'pending_inputs',
    'pending_work',
    'blocked_work',
    'statistics',
    'wake_pending',
    'activation',
    'parent_session_id',
    'forked_from',
    'fenced_work_id',
    'created_at',
    'updated_at',
  ],
  session_inputs: [
    'namespace',
    'session_id',
    'input_id',
    'cursor',
    'input',
    'work',
    'delivery',
    'prepared_execution',
    'accepted_at',
  ],
  session_subscriptions: [
    'namespace',
    'session_id',
    'subscription_id',
    'signal_id',
    'match',
    'match_key',
    'state',
    'created_at',
    'updated_at',
  ],
}

export const SESSION_REQUIRED_INDEXES: readonly string[] = [
  'sessions_namespace_key_hash_idx',
  'sessions_parent_session_idx',
  'session_inputs_namespace_cursor_idx',
  'session_inputs_work_idx',
  'session_subscriptions_session_idx',
  'session_subscriptions_signal_idx',
  'session_subscriptions_identity_idx',
]

export function sessionDdlStatements(schema: string): readonly string[] {
  const sessions = table(schema, 'sessions')
  const inputs = table(schema, 'session_inputs')
  const subscriptions = table(schema, 'session_subscriptions')
  return [
    `CREATE TABLE IF NOT EXISTS ${sessions} (
      namespace text NOT NULL,
      session_id text NOT NULL,
      key_hash text NOT NULL,
      target_id text NOT NULL,
      target_kind text NOT NULL DEFAULT 'agent',
      thread_id text NOT NULL,
      model jsonb,
      definition jsonb,
      state text NOT NULL,
      accepted_cursor bigint NOT NULL,
      processed_cursor bigint,
      pending_inputs integer NOT NULL,
      pending_work integer NOT NULL,
      blocked_work integer NOT NULL,
      statistics jsonb NOT NULL,
      wake_pending boolean NOT NULL,
      activation jsonb,
      parent_session_id text,
      forked_from jsonb,
      fenced_work_id text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, session_id),
      UNIQUE (namespace, key_hash)
    )`,
    `ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS target_kind text NOT NULL DEFAULT 'agent'`,
    `ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS definition jsonb`,
    `ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS parent_session_id text`,
    `ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS forked_from jsonb`,
    `ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS fenced_work_id text`,
    `ALTER TABLE ${sessions}
      ALTER COLUMN model DROP NOT NULL`,
    `CREATE INDEX IF NOT EXISTS sessions_parent_session_idx
      ON ${sessions} (namespace, parent_session_id)
      WHERE parent_session_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ${inputs} (
      namespace text NOT NULL,
      session_id text NOT NULL,
      input_id text NOT NULL,
      cursor bigint NOT NULL,
      input jsonb NOT NULL,
      work jsonb,
      delivery jsonb,
      prepared_execution jsonb,
      accepted_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, input_id),
      UNIQUE (namespace, session_id, cursor),
      FOREIGN KEY (namespace, session_id)
        REFERENCES ${sessions} (namespace, session_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS ${subscriptions} (
      namespace text NOT NULL,
      session_id text NOT NULL,
      subscription_id text NOT NULL,
      signal_id text NOT NULL,
      match jsonb,
      match_key text NOT NULL DEFAULT '',
      state text NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, subscription_id),
      FOREIGN KEY (namespace, session_id)
        REFERENCES ${sessions} (namespace, session_id) ON DELETE CASCADE
    )`,
    `ALTER TABLE ${subscriptions}
      ADD COLUMN IF NOT EXISTS match_key text NOT NULL DEFAULT ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "sessions_namespace_key_hash_idx"
      ON ${sessions} (namespace, key_hash)`,
    `CREATE INDEX IF NOT EXISTS "session_inputs_namespace_cursor_idx"
      ON ${inputs} (namespace, session_id, cursor)`,
    `CREATE INDEX IF NOT EXISTS "session_inputs_work_idx"
      ON ${inputs} (namespace, session_id, ((work ->> 'workId')))
      WHERE work IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "session_subscriptions_session_idx"
      ON ${subscriptions} (namespace, session_id, state)`,
    `CREATE INDEX IF NOT EXISTS "session_subscriptions_signal_idx"
      ON ${subscriptions} (namespace, signal_id, state)`,
    // Canonical subscription identity for concurrent idempotent upserts.
    `CREATE UNIQUE INDEX IF NOT EXISTS "session_subscriptions_identity_idx"
      ON ${subscriptions} (namespace, session_id, signal_id, match_key)`,
  ]
}
