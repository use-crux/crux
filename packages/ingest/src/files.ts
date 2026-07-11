import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, matchesGlob, resolve } from 'node:path'
import type { Asset } from '@use-crux/core'
import { errorFromUnknown, failed, narrowIngestErrorCode, ok, sourceLoader } from './document'
import { parseDocument } from './parsers'
import type { IngestFormat, ParserOptions, SourceLoader } from './types'
import { inferMediaFormat } from './media-format'

export interface FileSourceOptions extends ParserOptions {
  namespace: string
  sourceId?: string
}

export interface AssetFileSourceOptions extends ParserOptions {
  namespace: string
  sourceId: string
}

/** One explicitly identified asset in a batch file source. */
export interface AssetFileInput {
  readonly asset: Asset
  readonly sourceId: string
}

export interface FilesDirectoryInput {
  directory: string
  recursive?: boolean
}

export interface FilesGlobInput {
  glob: string | string[]
  cwd?: string
}

export interface FilesSourceOptions extends ParserOptions {
  namespace: string
}

export function fileSource(path: string, options: FileSourceOptions): SourceLoader
export function fileSource(asset: Asset, options: AssetFileSourceOptions): SourceLoader
export function fileSource(path: string | Asset, options: FileSourceOptions | AssetFileSourceOptions): SourceLoader {
  return sourceLoader(async function* () {
    yield await loadFileResult(path, options)
  })
}

export function filesSource(
  input: readonly (string | AssetFileInput)[] | FilesDirectoryInput | FilesGlobInput,
  options: FilesSourceOptions,
): SourceLoader {
  return sourceLoader(async function* () {
    const files = await resolvePaths(input)
    for (const file of files) {
      yield typeof file === 'string'
        ? await loadFileResult(file, { ...options, sourceId: undefined })
        : await loadFileResult(file.asset, { ...options, sourceId: file.sourceId })
    }
  })
}

async function loadFileResult(input: string | Asset, options: FileSourceOptions) {
  const absolutePath = typeof input === 'string' ? resolve(input) : undefined
  const sourceId = options.sourceId ?? absolutePath ?? ''

  try {
    if (!options.namespace.trim()) {
      throw new Error('File source namespace must be non-empty.')
    }

    if (!sourceId.trim()) throw new Error('Asset file source requires a non-empty sourceId.')
    const asset = typeof input === 'string' ? undefined : input
    const bytes = absolutePath ? new Uint8Array(await readFile(absolutePath)) : await assetBytes(asset!)
    const title = absolutePath ? basename(absolutePath) : asset?.filename
    const extension = title ? extname(title) : ''
    const contentType = absolutePath ? undefined : asset?.mediaType
    const format = resolveFileFormat(extension, contentType, bytes)
    const sourceFacts = absolutePath ? { sourcePath: absolutePath } : assetSourceFacts(asset!)
    const document = await parseDocument({
      namespace: options.namespace,
      sourceId,
      bytes,
      format,
      ...(title ? { title } : {}),
      ...(asset ? { asset } : {}),
      metadata: sourceFacts,
      ...(contentType ? { contentType } : {}),
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
      metadata: absolutePath ? { sourcePath: absolutePath } : assetSourceFacts(input as Asset),
    })
  }
}

async function resolvePaths(
  input: readonly (string | AssetFileInput)[] | FilesDirectoryInput | FilesGlobInput,
): Promise<Array<string | AssetFileInput>> {
  if ('directory' in input) {
    return listDirectoryFiles(resolve(input.directory), input.recursive ?? true)
  }

  if (!('glob' in input)) {
    return input.map((file) => typeof file === 'string' ? resolve(file) : file)
  }

  const patterns = Array.isArray(input.glob) ? input.glob : [input.glob]
  const cwd = resolve(input.cwd ?? process.cwd())
  const candidates = await listDirectoryFiles(cwd, true)

  return candidates.filter((candidate) => patterns.some((pattern) => matchesGlob(candidate, resolve(cwd, pattern))))
}

async function listDirectoryFiles(directory: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await listDirectoryFiles(fullPath, recursive)))
      }
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
      continue
    }

    const metadata = await stat(fullPath)
    if (metadata.isFile()) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

function normalizeExtension(extension: string): IngestFormat {
  switch (extension.toLowerCase()) {
    case '.txt':
      return 'txt'
    case '.md':
    case '.markdown':
      return 'md'
    case '.html':
    case '.htm':
      return 'html'
    case '.pdf':
      return 'pdf'
    case '.csv':
      return 'csv'
    case '.json':
      return 'json'
    case '.docx':
      return 'docx'
    case '.xlsx':
      return 'xlsx'
    default:
      return 'unknown'
  }
}

function resolveFileFormat(extension: string, contentType: string | undefined, bytes: Uint8Array): IngestFormat {
  const media = inferMediaFormat({ extension, contentType, bytes })
  return media !== 'unknown' ? media : normalizeExtension(extension)
}

async function assetBytes(asset: Asset): Promise<Uint8Array> {
  if (asset.type !== 'data') return new Uint8Array()
  return asset.data instanceof Uint8Array ? asset.data.slice() : new Uint8Array(await asset.data.arrayBuffer())
}

function assetSourceFacts(asset: Asset): Record<string, unknown> {
  return {
    ...(asset.type === 'url' ? { sourceUrl: safeUrl(asset.url) } : {}),
    ...('ref' in asset ? { assetRef: asset.ref } : {}),
    ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
  }
}

function safeUrl(url: URL): string {
  const safe = new URL(url.href)
  safe.username = ''
  safe.password = ''
  safe.search = ''
  safe.hash = ''
  return safe.href
}
