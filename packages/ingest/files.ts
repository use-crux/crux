import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, matchesGlob, resolve } from 'node:path'
import { errorFromUnknown, failed, narrowIngestErrorCode, ok, sourceLoader } from './document'
import { parseDocument } from './parsers'
import type { IngestFormat, ParserOptions, SourceLoader } from './types'

export interface FileSourceOptions extends ParserOptions {
  namespace: string
  sourceId?: string
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

export function fileSource(path: string, options: FileSourceOptions): SourceLoader {
  return sourceLoader(async function* () {
    yield await loadFileResult(path, options)
  })
}

export function filesSource(
  input: string[] | FilesDirectoryInput | FilesGlobInput,
  options: FilesSourceOptions,
): SourceLoader {
  return sourceLoader(async function* () {
    const paths = await resolvePaths(input)
    for (const path of paths) {
      yield await loadFileResult(path, { ...options, sourceId: undefined })
    }
  })
}

async function loadFileResult(path: string, options: FileSourceOptions) {
  const absolutePath = resolve(path)
  const sourceId = options.sourceId ?? absolutePath

  try {
    if (!options.namespace.trim()) {
      throw new Error('File source namespace must be non-empty.')
    }

    const format = normalizeExtension(extname(absolutePath))
    const bytes = await readFile(absolutePath)
    const document = await parseDocument({
      namespace: options.namespace,
      sourceId,
      bytes,
      format,
      title: basename(absolutePath),
      metadata: {
        sourcePath: absolutePath,
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
      metadata: { sourcePath: absolutePath },
    })
  }
}

async function resolvePaths(input: string[] | FilesDirectoryInput | FilesGlobInput): Promise<string[]> {
  if (Array.isArray(input)) {
    return input.map((path) => resolve(path))
  }

  if ('directory' in input) {
    return listDirectoryFiles(resolve(input.directory), input.recursive ?? true)
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
