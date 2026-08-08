import { errorFromUnknown, failed, narrowIngestErrorCode, ok, sourceLoader } from './document'
import { parseDocument } from './parsers'
import type { IngestFormat, ParserOptions, SourceLoader } from './types'
import { inferMediaFormat } from './media-format'

export interface UrlSourceOptions extends ParserOptions {
  namespace: string
  sourceId?: string
  fetch?: typeof fetch
}

export interface UrlsSourceOptions extends ParserOptions {
  namespace: string
  fetch?: typeof fetch
}

export function urlSource(url: string, options: UrlSourceOptions): SourceLoader {
  return sourceLoader(async function* () {
    yield await loadUrlResult(url, options)
  })
}

export function urlsSource(urls: string[], options: UrlsSourceOptions): SourceLoader {
  return sourceLoader(async function* () {
    for (const url of urls) {
      yield await loadUrlResult(url, {
        ...options,
        sourceId: undefined,
      })
    }
  })
}

async function loadUrlResult(url: string, options: UrlSourceOptions) {
  const sourceUrl = safeSourceUrl(url)
  const sourceId = options.sourceId ?? sourceUrl

  try {
    if (!options.namespace.trim()) {
      throw new Error('URL source namespace must be non-empty.')
    }

    const fetchImpl = options.fetch ?? globalThis.fetch
    if (!fetchImpl) {
      throw new Error('URL ingestion requires fetch.')
    }

    const response = await fetchImpl(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch URL source: ${response.status} ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const bytes = new Uint8Array(await response.arrayBuffer())
    const format = inferFormat(contentType, url, bytes)
    const document = await parseDocument({
      namespace: options.namespace,
      sourceId,
      bytes,
      format,
      metadata: {
        sourceUrl,
        contentType,
      },
      source: {
        url: sourceUrl,
        ...(safeMediaType(contentType) ? { mediaType: safeMediaType(contentType) } : {}),
      },
      options,
    })

    return ok(document)
  } catch (error) {
    return failed({
      namespace: options.namespace,
      sourceId,
      error: errorFromUnknown(
        error,
        !options.namespace.trim() ? 'empty_namespace' : narrowIngestErrorCode(error) ?? 'load_failed',
        error && typeof error === 'object' && 'parser' in error
          ? String((error as { parser: unknown }).parser)
          : undefined,
      ),
      metadata: { sourceUrl },
    })
  }
}

function safeMediaType(value: string): string | undefined {
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType?.includes('/') ? mediaType : undefined
}

function safeSourceUrl(value: string): string {
  const url = new URL(value)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}

function inferFormat(contentType: string, url: string, bytes: Uint8Array): IngestFormat {
  const lowerUrl = url.toLowerCase()
  const media = inferMediaFormat({ extension: lowerUrl, contentType, bytes })
  if (media !== 'unknown') return media
  if (
    contentType.includes('application/pdf') ||
    lowerUrl.endsWith('.pdf') ||
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46])
  ) {
    return 'pdf'
  }
  if (contentType.includes('text/html') || lowerUrl.endsWith('.html') || lowerUrl.endsWith('.htm')) {
    return 'html'
  }
  if (contentType.includes('markdown') || lowerUrl.endsWith('.md') || lowerUrl.endsWith('.markdown')) {
    return 'md'
  }
  if (contentType.includes('csv') || lowerUrl.endsWith('.csv')) {
    return 'csv'
  }
  if (contentType.includes('json') || lowerUrl.endsWith('.json')) {
    return 'json'
  }
  if (lowerUrl.endsWith('.docx')) {
    return 'docx'
  }
  if (lowerUrl.endsWith('.xlsx')) {
    return 'xlsx'
  }
  if (lowerUrl.endsWith('.xlsm')) {
    return 'xlsm'
  }
  if (contentType.includes('text/plain') || contentType.startsWith('text/')) {
    return 'txt'
  }
  return 'unknown'
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}
