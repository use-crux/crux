import { table } from './sql'

export const TRANSPORT_POSTGRES_TABLES: readonly [
  'transport_envelopes',
  'transport_statistics',
] = ['transport_envelopes', 'transport_statistics']

export const TRANSPORT_REQUIRED_COLUMNS: Readonly<
  Record<(typeof TRANSPORT_POSTGRES_TABLES)[number], readonly string[]>
> = {
  transport_envelopes: [
    'namespace',
    'provider',
    'account_id',
    'event_id',
    'binding_id',
    'envelope',
    'envelope_digest',
    'state',
    'attempts',
    'max_attempts',
    'accepted_at',
    'updated_at',
    'next_attempt_at',
    'lease_token',
    'lease_expires_at',
    'last_failure',
    'lineage',
  ],
  transport_statistics: ['namespace', 'statistics', 'updated_at'],
}

export const TRANSPORT_REQUIRED_INDEXES: readonly string[] = [
  'transport_envelopes_claimable_idx',
  'transport_envelopes_retention_idx',
]

export function transportDdlStatements(schema: string): readonly string[] {
  const envelopes = table(schema, 'transport_envelopes')
  const statistics = table(schema, 'transport_statistics')
  return [
    `CREATE TABLE IF NOT EXISTS ${envelopes} (
      namespace text NOT NULL,
      provider text NOT NULL,
      account_id text NOT NULL,
      event_id text NOT NULL,
      binding_id text NOT NULL,
      envelope jsonb NOT NULL,
      envelope_digest text NOT NULL,
      state text NOT NULL,
      attempts integer NOT NULL,
      max_attempts integer NOT NULL,
      accepted_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      next_attempt_at timestamptz NOT NULL,
      lease_token text,
      lease_expires_at timestamptz,
      last_failure jsonb,
      lineage jsonb,
      PRIMARY KEY (namespace, provider, account_id, event_id)
    )`,
    `ALTER TABLE ${envelopes} ADD COLUMN IF NOT EXISTS lineage jsonb`,
    `CREATE TABLE IF NOT EXISTS ${statistics} (
      namespace text PRIMARY KEY,
      statistics jsonb NOT NULL,
      updated_at timestamptz NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS transport_envelopes_claimable_idx
      ON ${envelopes} (namespace, state, next_attempt_at)`,
    `CREATE INDEX IF NOT EXISTS transport_envelopes_retention_idx
      ON ${envelopes} (namespace, state, updated_at)`,
  ]
}
