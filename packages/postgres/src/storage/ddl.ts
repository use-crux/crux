import type { PostgresStorageSetupFinding } from './types'
import { quoteIdent, storageTable, type PgExecutor } from './sql'

const RECORD_COLUMNS = ['key', 'value', 'expires_at', 'version'] as const
const VECTOR_COLUMNS = ['key', 'dense', 'metadata'] as const

export interface StorageDdlOptions {
  readonly records: boolean
  readonly vectors: boolean
  readonly dimensions?: number
  readonly sparseDimensions?: number
}

export function storageDdlStatements(schema: string, options: StorageDdlOptions): readonly string[] {
  const records = storageTable(schema, 'records')
  const vectors = storageTable(schema, 'vectors')
  const statements: string[] = []
  if (options.vectors) statements.push('CREATE EXTENSION IF NOT EXISTS vector')
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
  if (options.vectors) {
    const dimensions = options.dimensions!
    const presenceConstraint =
      options.sparseDimensions === undefined
        ? 'dense vector(' + dimensions + ') NOT NULL'
        : `dense vector(${dimensions}), sparse sparsevec(${options.sparseDimensions}),
          CONSTRAINT vectors_has_vector CHECK (dense IS NOT NULL OR sparse IS NOT NULL)`
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${vectors} (
        key text PRIMARY KEY,
        ${presenceConstraint},
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      )`,
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'vectors_dense_hnsw_idx')}
        ON ${vectors} USING hnsw (dense vector_cosine_ops)`,
    )
    if (options.sparseDimensions !== undefined) {
      statements.push(
        `ALTER TABLE ${vectors}
          ADD COLUMN IF NOT EXISTS sparse sparsevec(${options.sparseDimensions})`,
        `ALTER TABLE ${vectors} ALTER COLUMN dense DROP NOT NULL`,
        `DO $crux$
         BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = ${quoteLiteral(schema)}
               AND t.relname = 'vectors'
               AND c.conname = 'vectors_has_vector'
           ) THEN
             ALTER TABLE ${vectors}
               ADD CONSTRAINT vectors_has_vector
               CHECK (dense IS NOT NULL OR sparse IS NOT NULL);
           END IF;
         END
         $crux$`,
        `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'vectors_sparse_hnsw_idx')}
          ON ${vectors} USING hnsw (sparse sparsevec_cosine_ops)`,
      )
    }
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${qualifiedIndex(schema, 'vectors_metadata_gin_idx')}
        ON ${vectors} USING gin (metadata jsonb_path_ops)`,
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
  if (options.vectors) {
    const extension = await executor.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`,
    )
    if (!extension.rows[0]?.installed) {
      findings.push({
        code: 'POSTGRES_VECTOR_EXTENSION_MISSING',
        resource: 'extension:vector',
        message: 'The PostgreSQL vector extension is not installed.',
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
  if (options.vectors) {
    const columns = [...VECTOR_COLUMNS, ...(options.sparseDimensions === undefined ? [] : ['sparse'])]
    const exists = await checkTable(executor, schema, 'vectors', columns, findings)
    if (exists) {
      await Promise.all([
        checkColumnType(executor, schema, 'vectors', 'key', 'text', findings),
        checkColumnType(executor, schema, 'vectors', 'metadata', 'jsonb', findings),
        checkColumnType(executor, schema, 'vectors', 'dense', `vector(${options.dimensions})`, findings),
        checkNotNull(
          executor,
          schema,
          'vectors',
          ['key', 'metadata', ...(options.sparseDimensions === undefined ? ['dense'] : [])],
          findings,
        ),
        checkPrimaryKey(executor, schema, 'vectors', 'key', findings),
      ])
      if (options.sparseDimensions !== undefined) {
        await checkColumnType(executor, schema, 'vectors', 'sparse', `sparsevec(${options.sparseDimensions})`, findings)
        const constraint = await executor.query<{ installed: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = $1 AND t.relname = 'vectors'
               AND c.conname = 'vectors_has_vector'
           ) AS installed`,
          [schema],
        )
        if (!constraint.rows[0]?.installed) {
          findings.push({
            code: 'POSTGRES_STORAGE_CONSTRAINT_MISSING',
            resource: 'vectors:vectors_has_vector',
            message: 'The vector presence constraint is missing.',
          })
        }
      }
    }
    await checkIndexes(
      executor,
      schema,
      {
        vectors_dense_hnsw_idx: ['using hnsw', 'vector_cosine_ops'],
        ...(options.sparseDimensions === undefined
          ? {}
          : {
              vectors_sparse_hnsw_idx: ['using hnsw', 'sparsevec_cosine_ops'],
            }),
        vectors_metadata_gin_idx: ['using gin', 'jsonb_path_ops'],
      },
      findings,
    )
  }
  return findings
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
