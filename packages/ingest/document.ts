import type { IngestDocument, IngestError, IngestLoadResult, IngestPart, IngestTablePart, SourceLoader } from './types'

export function ok(document: IngestDocument): IngestLoadResult {
  return { ok: true, document }
}

export function failed(input: {
  namespace: string
  sourceId: string
  error: IngestError
  metadata?: Record<string, unknown>
}): IngestLoadResult {
  return {
    ok: false,
    namespace: input.namespace,
    sourceId: input.sourceId,
    error: input.error,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

export function sourceLoader(load: () => AsyncIterable<IngestLoadResult>): SourceLoader {
  return {
    load,
    async *documents(): AsyncIterable<IngestDocument> {
      for await (const result of load()) {
        if (!result.ok) {
          throw new Error(result.error.message)
        }
        yield result.document
      }
    },
  }
}

export function normalizeDocument(document: {
  namespace: string
  sourceId: string
  title?: string
  parts?: IngestPart[]
  content?: string
  metadata?: Record<string, unknown>
  warnings?: IngestDocument['warnings']
}): IngestDocument {
  if (!document.namespace.trim()) {
    throw new Error('Ingest document namespace must be non-empty.')
  }
  if (!document.sourceId.trim()) {
    throw new Error('Ingest document sourceId must be non-empty.')
  }

  const parts =
    document.parts ??
    (document.content !== undefined
      ? [
          {
            id: 'text:1',
            kind: 'text' as const,
            role: 'paragraph' as const,
            content: document.content,
          },
        ]
      : [])

  return {
    namespace: document.namespace,
    sourceId: document.sourceId,
    ...(document.title ? { title: document.title } : {}),
    parts,
    content: document.content ?? deriveContent(parts),
    ...(document.metadata ? { metadata: document.metadata } : {}),
    ...(document.warnings?.length ? { warnings: document.warnings } : {}),
  }
}

export function deriveContent(parts: IngestPart[]): string {
  return parts
    .map((part) => renderPart(part))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function renderPart(part: IngestPart): string {
  switch (part.kind) {
    case 'text':
      if (part.role === 'heading') {
        return headingLabel(part.headingPath, part.content)
      }
      return part.content.trim()
    case 'page':
      return `[Page ${part.pageNumber}]\n${part.content.trim()}`
    case 'table':
      return renderTable(part)
    case 'sheet':
      return `[Sheet: ${part.sheetName}]\n${part.content.trim()}`
    case 'json':
      return `[JSON: ${part.path}]\n${part.content.trim()}`
  }
}

function headingLabel(path: string[] | undefined, content: string): string {
  if (path?.length) {
    return path.map((entry, index) => `${'#'.repeat(Math.min(index + 1, 6))} ${entry}`).join('\n')
  }
  return `# ${content.trim()}`
}

function renderTable(part: IngestTablePart): string {
  const label = [
    part.caption ? `[Table: ${part.caption}]` : '[Table]',
    part.sheetName ? `[Sheet: ${part.sheetName}]` : undefined,
    part.pageNumber ? `[Page ${part.pageNumber}]` : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  const rows = part.rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${label}\n${rows}`.trim()
}

const INGEST_ERROR_CODES: ReadonlySet<IngestError['code']> = new Set([
  'unsupported_format',
  'parse_failed',
  'load_failed',
  'invalid_document',
  'empty_namespace',
  'empty_source_id',
])

/**
 * Return the `IngestError['code']` if the error carries a recognized `code`
 * property; otherwise return `undefined` so callers can fall back to a default.
 */
export function narrowIngestErrorCode(error: unknown): IngestError['code'] | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code: unknown }).code
  if (typeof code !== 'string') return undefined
  return INGEST_ERROR_CODES.has(code as IngestError['code']) ? (code as IngestError['code']) : undefined
}

export function errorFromUnknown(error: unknown, code: IngestError['code'], parser?: string): IngestError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(parser ? { parser } : {}),
    }
  }

  return {
    code,
    message: String(error),
    ...(parser ? { parser } : {}),
  }
}
