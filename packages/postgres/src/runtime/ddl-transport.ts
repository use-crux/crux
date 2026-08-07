import { table } from './sql'

export const TRANSPORT_POSTGRES_TABLES: readonly [
  'transport_envelopes',
  'transport_statistics',
  'transport_binding_checkpoints',
] = [
  'transport_envelopes',
  'transport_statistics',
  'transport_binding_checkpoints',
]

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
  transport_binding_checkpoints: [
    'namespace',
    'binding_id',
    'cursor',
    'updated_at',
    'last_polled_at',
    'last_owner_id',
    'last_error_code',
    'more_pending',
    'config_ref_id',
    'config_ref_revision',
    'status',
  ],
}

export const TRANSPORT_REQUIRED_INDEXES: readonly string[] = [
  'transport_envelopes_claimable_idx',
  'transport_envelopes_retention_idx',
]

export function transportDdlStatements(schema: string): readonly string[] {
  const envelopes = table(schema, 'transport_envelopes')
  const statistics = table(schema, 'transport_statistics')
  const checkpoints = table(schema, 'transport_binding_checkpoints')
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
    `CREATE TABLE IF NOT EXISTS ${checkpoints} (
      namespace text NOT NULL,
      binding_id text NOT NULL,
      cursor text,
      updated_at timestamptz NOT NULL,
      last_polled_at timestamptz,
      last_owner_id text,
      last_error_code text,
      more_pending boolean,
      config_ref_id text,
      config_ref_revision text,
      status text,
      PRIMARY KEY (namespace, binding_id)
    )`,
    // Additive upgrades for DBs created before managed stream checkpoint fields.
    `ALTER TABLE ${checkpoints} ADD COLUMN IF NOT EXISTS config_ref_id text`,
    `ALTER TABLE ${checkpoints} ADD COLUMN IF NOT EXISTS config_ref_revision text`,
    `ALTER TABLE ${checkpoints} ADD COLUMN IF NOT EXISTS status text`,
    `CREATE INDEX IF NOT EXISTS transport_envelopes_claimable_idx
      ON ${envelopes} (namespace, state, next_attempt_at)`,
    `CREATE INDEX IF NOT EXISTS transport_envelopes_retention_idx
      ON ${envelopes} (namespace, state, updated_at)`,
  ]
}
