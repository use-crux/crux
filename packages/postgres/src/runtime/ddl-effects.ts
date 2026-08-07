import { table } from './sql'

export const EFFECTS_POSTGRES_TABLES = ['effect_records'] as const

export const EFFECTS_REQUIRED_COLUMNS = {
  effect_records: [
    'namespace',
    'kind',
    'record_id',
    'boundary_id',
    'record',
    'revision',
    'fence_token',
  ],
} as const

export const EFFECTS_REQUIRED_INDEXES = [
  'effect_records_boundary_kind_idx',
] as const

export function effectsDdlStatements(schema: string): readonly string[] {
  const records = table(schema, 'effect_records')
  return [
    `CREATE TABLE IF NOT EXISTS ${records} (
      namespace text NOT NULL,
      kind text NOT NULL,
      record_id text NOT NULL,
      boundary_id text NOT NULL,
      record jsonb NOT NULL,
      revision integer NOT NULL,
      fence_token text,
      PRIMARY KEY (namespace, kind, record_id)
    )`,
    `CREATE INDEX IF NOT EXISTS "effect_records_boundary_kind_idx"
      ON ${records} (namespace, boundary_id, kind)`,
  ]
}
