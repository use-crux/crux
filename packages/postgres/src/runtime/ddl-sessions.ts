import { table } from './sql'

export const SESSION_POSTGRES_TABLES: readonly ['sessions', 'session_inputs'] =
  ['sessions', 'session_inputs']

export const SESSION_REQUIRED_COLUMNS: Readonly<
  Record<(typeof SESSION_POSTGRES_TABLES)[number], readonly string[]>
> = {
  sessions: [
    'namespace',
    'session_id',
    'key_hash',
    'target_id',
    'thread_id',
    'model',
    'state',
    'accepted_cursor',
    'processed_cursor',
    'pending_inputs',
    'pending_work',
    'blocked_work',
    'statistics',
    'wake_pending',
    'activation',
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
}

export const SESSION_REQUIRED_INDEXES: readonly string[] = [
  'sessions_namespace_key_hash_idx',
  'session_inputs_namespace_cursor_idx',
  'session_inputs_work_idx',
]

export function sessionDdlStatements(schema: string): readonly string[] {
  const sessions = table(schema, 'sessions')
  const inputs = table(schema, 'session_inputs')
  return [
    `CREATE TABLE IF NOT EXISTS ${sessions} (
      namespace text NOT NULL,
      session_id text NOT NULL,
      key_hash text NOT NULL,
      target_id text NOT NULL,
      thread_id text NOT NULL,
      model jsonb NOT NULL,
      state text NOT NULL,
      accepted_cursor bigint NOT NULL,
      processed_cursor bigint,
      pending_inputs integer NOT NULL,
      pending_work integer NOT NULL,
      blocked_work integer NOT NULL,
      statistics jsonb NOT NULL,
      wake_pending boolean NOT NULL,
      activation jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (namespace, session_id),
      UNIQUE (namespace, key_hash)
    )`,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS "sessions_namespace_key_hash_idx"
      ON ${sessions} (namespace, key_hash)`,
    `CREATE INDEX IF NOT EXISTS "session_inputs_namespace_cursor_idx"
      ON ${inputs} (namespace, session_id, cursor)`,
    `CREATE INDEX IF NOT EXISTS "session_inputs_work_idx"
      ON ${inputs} (namespace, session_id, ((work ->> 'workId')))
      WHERE work IS NOT NULL`,
  ]
}
