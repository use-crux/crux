import type { PostgresStorageSetupFinding } from './types'
import { quoteIdent, storageTable, type PgExecutor } from './sql'

const RECORD_COLUMNS = ['key', 'value', 'expires_at', 'version'] as const
const SEARCH_BASE_COLUMNS = ['key', 'metadata'] as const

export interface StorageDdlOptions {
  readonly records: boolean
  readonly search: boolean
  readonly dimensions?: number
  readonly sparseDimensions?: number
  readonly lexicalConfiguration?: string
}

export function storageDdlStatements(schema: string, options: StorageDdlOptions): readonly string[] {
  const records = storageTable(schema, 'records')
  const search = storageTable(schema, 'search')
  const statements: string[] = []
  if (searchNeedsPgvector(options)) statements.push('CREATE EXTENSION IF NOT EXISTS vector')
  statements.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
  if (options.records) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${records} (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        expires_at timestamptz,
        version bigint NOT NULL DEFAULT 1
      )`,
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'records_key_prefix_idx')}
        ON ${records} (key text_pattern_ops)`,
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'records_expires_at_idx')}
        ON ${records} (expires_at)`,
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'records_value_gin_idx')}
        ON ${records} USING gin (value jsonb_path_ops)`,
    )
  }
  if (options.search) {
    const payloadColumns = searchPayloadColumnDefinitions(options)
    const presenceConstraint = searchPresenceConstraint(options)
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${search} (
        key text PRIMARY KEY,
        ${payloadColumns.join(',\n        ')},
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        ${presenceConstraint ? `,\n        ${presenceConstraint}` : ''}
      )`,
    )
    if (options.dimensions !== undefined) {
      statements.push(
        `ALTER TABLE ${search}
          ADD COLUMN IF NOT EXISTS dense vector(${options.dimensions})`,
        `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'search_dense_hnsw_idx')}
          ON ${search} USING hnsw (dense vector_cosine_ops)`,
      )
    }
    if (options.sparseDimensions !== undefined) {
      statements.push(
        `ALTER TABLE ${search}
          ADD COLUMN IF NOT EXISTS sparse sparsevec(${options.sparseDimensions})`,
        `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'search_sparse_hnsw_idx')}
          ON ${search} USING hnsw (sparse sparsevec_cosine_ops)`,
      )
    }
    if (options.lexicalConfiguration !== undefined) {
      const configuration = quoteLiteral(options.lexicalConfiguration)
      statements.push(
        `ALTER TABLE ${search}
          ADD COLUMN IF NOT EXISTS content text`,
        `ALTER TABLE ${search}
          ADD COLUMN IF NOT EXISTS search_document tsvector GENERATED ALWAYS AS (
            to_tsvector(${configuration}::regconfig, coalesce(content, ''))
          ) STORED`,
        `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'search_document_gin_idx')}
          ON ${search} USING gin (search_document)`,
      )
    }
    if (presenceConstraint) {
      statements.push(
        `ALTER TABLE ${search} DROP CONSTRAINT IF EXISTS search_has_payload`,
        `ALTER TABLE ${search} ADD CONSTRAINT search_has_payload CHECK (${searchPresenceExpression(options)})`,
      )
    }
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'search_metadata_gin_idx')}
        ON ${search} USING gin (metadata jsonb_path_ops)`,
    )
  }
  return statements
}

export async function checkStorageDdl(
  executor: PgExecutor,
  schema: string,
  options: StorageDdlOptions,
): Promise<PostgresStorageSetupFinding[]> {
  const findings: PostgresStorageSetupFinding[] = []
  if (searchNeedsPgvector(options)) {
    const extension = await executor.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`,
    )
    if (!extension.rows[0]?.installed) {
      findings.push({
        code: 'POSTGRES_SEARCH_VECTOR_EXTENSION_MISSING',
        resource: 'extension:vector',
        message: 'The PostgreSQL vector extension required by search storage is not installed.',
        remediation: 'CREATE EXTENSION IF NOT EXISTS vector;',
      })
      return findings
    }
  }

  const schemaResult = await executor.query<{ installed: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS installed`,
    [schema],
  )
  if (!schemaResult.rows[0]?.installed) {
    findings.push({
      code: 'POSTGRES_STORAGE_SCHEMA_MISSING',
      resource: 'storage-schema',
      message: 'The configured PostgreSQL storage schema does not exist.',
    })
    return findings
  }

  if (options.records) {
    const exists = await checkTable(executor, schema, 'records', RECORD_COLUMNS, findings)
    if (exists) {
      await Promise.all([
        checkColumnType(executor, schema, 'records', 'key', 'text', findings),
        checkColumnType(executor, schema, 'records', 'value', 'jsonb', findings),
        checkColumnType(executor, schema, 'records', 'expires_at', 'timestamp with time zone', findings),
        checkColumnType(executor, schema, 'records', 'version', 'bigint', findings),
        checkNotNull(executor, schema, 'records', ['key', 'value', 'version'], findings),
        checkPrimaryKey(executor, schema, 'records', 'key', findings),
      ])
    }
    await checkIndexes(
      executor,
      schema,
      {
        records_key_prefix_idx: ['text_pattern_ops'],
        records_expires_at_idx: ['expires_at'],
        records_value_gin_idx: ['using gin', 'jsonb_path_ops'],
      },
      findings,
    )
  }
  if (options.search) {
    const columns = [
      ...SEARCH_BASE_COLUMNS,
      ...(options.dimensions === undefined ? [] : ['dense']),
      ...(options.sparseDimensions === undefined ? [] : ['sparse']),
      ...(options.lexicalConfiguration === undefined ? [] : ['content', 'search_document']),
    ]
    const exists = await checkTable(executor, schema, 'search', columns, findings)
    if (exists) {
      await Promise.all([
        checkColumnType(executor, schema, 'search', 'key', 'text', findings),
        checkColumnType(executor, schema, 'search', 'metadata', 'jsonb', findings),
        checkNotNull(executor, schema, 'search', ['key', 'metadata'], findings),
        checkPrimaryKey(executor, schema, 'search', 'key', findings),
        checkSearchPresenceConstraint(executor, schema, options, findings),
      ])
      if (options.dimensions !== undefined) {
        await checkColumnType(executor, schema, 'search', 'dense', `vector(${options.dimensions})`, findings)
      }
      if (options.sparseDimensions !== undefined) {
        await checkColumnType(executor, schema, 'search', 'sparse', `sparsevec(${options.sparseDimensions})`, findings)
      }
      if (options.lexicalConfiguration !== undefined) {
        await checkColumnType(executor, schema, 'search', 'content', 'text', findings)
        await checkColumnType(executor, schema, 'search', 'search_document', 'tsvector', findings)
        await checkSearchDocumentGeneration(executor, schema, options.lexicalConfiguration, findings)
      }
    }
    await checkIndexes(
      executor,
      schema,
      {
        ...(options.dimensions === undefined ? {} : { search_dense_hnsw_idx: ['using hnsw', 'vector_cosine_ops'] }),
        ...(options.sparseDimensions === undefined
          ? {}
          : { search_sparse_hnsw_idx: ['using hnsw', 'sparsevec_cosine_ops'] }),
        ...(options.lexicalConfiguration === undefined ? {} : { search_document_gin_idx: ['using gin'] }),
        search_metadata_gin_idx: ['using gin', 'jsonb_path_ops'],
      },
      findings,
    )
  }
  return findings
}

function searchNeedsPgvector(options: StorageDdlOptions): boolean {
  return options.search && (options.dimensions !== undefined || options.sparseDimensions !== undefined)
}

function searchPayloadColumnDefinitions(options: StorageDdlOptions): readonly string[] {
  const columns: string[] = []
  if (options.dimensions !== undefined) columns.push(`dense vector(${options.dimensions})`)
  if (options.sparseDimensions !== undefined) columns.push(`sparse sparsevec(${options.sparseDimensions})`)
  if (options.lexicalConfiguration !== undefined) {
    columns.push(
      `content text`,
      `search_document tsvector GENERATED ALWAYS AS (
        to_tsvector(${quoteLiteral(options.lexicalConfiguration)}::regconfig, coalesce(content, ''))
      ) STORED`,
    )
  }
  return columns
}

function searchPresenceConstraint(options: StorageDdlOptions): string {
  return `CONSTRAINT search_has_payload CHECK (${searchPresenceExpression(options)})`
}

function searchPresenceExpression(options: StorageDdlOptions): string {
  return [
    ...(options.dimensions === undefined ? [] : ['dense IS NOT NULL']),
    ...(options.sparseDimensions === undefined ? [] : ['sparse IS NOT NULL']),
    ...(options.lexicalConfiguration === undefined ? [] : ['content IS NOT NULL']),
  ].join(' OR ')
}

async function checkSearchPresenceConstraint(
  executor: PgExecutor,
  schema: string,
  options: StorageDdlOptions,
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const expected = searchPresenceExpression(options)
  const result = await executor.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = 'search'
       AND c.conname = 'search_has_payload'`,
    [schema],
  )
  const actual = result.rows[0]?.definition
  if (actual === undefined) {
    findings.push({
      code: 'POSTGRES_STORAGE_CONSTRAINT_MISSING',
      resource: 'search:search_has_payload',
      message: 'The search payload presence constraint is missing.',
    })
    return
  }
  if (!normalizeConstraint(actual).includes(normalizeConstraint(expected))) {
    findings.push({
      code: 'POSTGRES_STORAGE_CONSTRAINT_INCOMPATIBLE',
      resource: 'search:search_has_payload',
      message: 'The search payload presence constraint is incompatible.',
    })
  }
}

async function checkSearchDocumentGeneration(
  executor: PgExecutor,
  schema: string,
  configuration: string,
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const result = await executor.query<{ expression: string | null }>(
    `SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
     FROM pg_attribute a
     JOIN pg_class t ON t.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = $1 AND t.relname = 'search'
       AND a.attname = 'search_document' AND NOT a.attisdropped`,
    [schema],
  )
  const expression = result.rows[0]?.expression
  const normalized = expression?.toLowerCase() ?? ''
  if (!expression || !normalized.includes('to_tsvector') || !normalized.includes(configuration.toLowerCase())) {
    findings.push({
      code: 'POSTGRES_SEARCH_CONFIGURATION_INCOMPATIBLE',
      resource: 'search:search_document',
      message: 'The generated search document uses an incompatible PostgreSQL text-search configuration.',
    })
  }
}

function normalizeConstraint(value: string): string {
  return value.toLowerCase().replaceAll('"', '').replaceAll(/[()\s]+/g, '')
}

async function checkTable(
  executor: PgExecutor,
  schema: string,
  table: string,
  columns: readonly string[],
  findings: PostgresStorageSetupFinding[],
): Promise<boolean> {
  const result = await executor.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  )
  if (result.rows.length === 0) {
    findings.push({
      code: 'POSTGRES_STORAGE_TABLE_MISSING',
      resource: `table:${table}`,
      message: `The required PostgreSQL storage table "${table}" does not exist.`,
    })
    return false
  }
  const actual = new Set(result.rows.map((row) => row.column_name))
  for (const column of columns) {
    if (!actual.has(column)) {
      findings.push({
        code: 'POSTGRES_STORAGE_COLUMN_MISSING',
        resource: `${table}:${column}`,
        message: `A required column is missing from PostgreSQL storage table "${table}".`,
      })
    }
  }
  return true
}

async function checkColumnType(
  executor: PgExecutor,
  schema: string,
  table: string,
  column: string,
  expected: string,
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const result = await executor.query<{ formatted_type: string }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS formatted_type
     FROM pg_attribute a
     JOIN pg_class t ON t.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2
       AND a.attname = $3 AND NOT a.attisdropped`,
    [schema, table, column],
  )
  const actual = result.rows[0]?.formatted_type
  if (actual !== undefined && actual !== expected) {
    findings.push({
      code: 'POSTGRES_STORAGE_COLUMN_INCOMPATIBLE',
      resource: `${table}:${column}`,
      message: `An existing PostgreSQL storage column has an incompatible type or dimensions.`,
    })
  }
}

async function checkIndexes(
  executor: PgExecutor,
  schema: string,
  expected: Readonly<Record<string, readonly string[]>>,
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const names = Object.keys(expected)
  const result = await executor.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])`,
    [schema, names],
  )
  const actual = new Map(result.rows.map((row) => [row.indexname, row.indexdef.toLowerCase()]))
  for (const name of names) {
    const definition = actual.get(name)
    if (!definition) {
      findings.push({
        code: 'POSTGRES_STORAGE_INDEX_MISSING',
        resource: `index:${name}`,
        message: 'A required PostgreSQL storage index is missing.',
      })
    } else if (!expected[name]!.every((part) => definition.includes(part))) {
      findings.push({
        code: 'POSTGRES_STORAGE_INDEX_INCOMPATIBLE',
        resource: `index:${name}`,
        message: 'An existing PostgreSQL storage index has an incompatible definition.',
      })
    }
  }
}

async function checkPrimaryKey(
  executor: PgExecutor,
  schema: string,
  table: string,
  column: string,
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const result = await executor.query<{ installed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN unnest(c.conkey) WITH ORDINALITY keys(attnum, ordinal) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = keys.attnum
       WHERE n.nspname = $1 AND t.relname = $2
         AND c.contype = 'p' AND a.attname = $3
       GROUP BY c.oid
       HAVING count(*) = 1
     ) AS installed`,
    [schema, table, column],
  )
  if (!result.rows[0]?.installed) {
    findings.push({
      code: 'POSTGRES_STORAGE_CONSTRAINT_MISSING',
      resource: `${table}:primary-key`,
      message: 'The required PostgreSQL storage primary key is missing.',
    })
  }
}

async function checkNotNull(
  executor: PgExecutor,
  schema: string,
  table: string,
  columns: readonly string[],
  findings: PostgresStorageSetupFinding[],
): Promise<void> {
  const result = await executor.query<{ attname: string; attnotnull: boolean }>(
    `SELECT a.attname, a.attnotnull
     FROM pg_attribute a
     JOIN pg_class t ON t.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2
       AND a.attname = ANY($3::text[]) AND NOT a.attisdropped`,
    [schema, table, columns],
  )
  const notNull = new Set(result.rows.filter((row) => row.attnotnull).map((row) => row.attname))
  for (const column of columns) {
    if (!notNull.has(column)) {
      findings.push({
        code: 'POSTGRES_STORAGE_CONSTRAINT_MISSING',
        resource: `${table}:${column}:not-null`,
        message: 'A required PostgreSQL storage not-null constraint is missing.',
      })
    }
  }
}

function qualifiedIndex(schema: string, name: string): string {
  void schema
  return quoteIdent(name)
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
