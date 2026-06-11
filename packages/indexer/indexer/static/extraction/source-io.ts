import { readFile } from 'node:fs/promises'
import ts from 'typescript'

/**
 * Source text provider for static extraction.
 *
 * The engine asks for source by absolute file path and does not care whether that source comes from
 * disk, an in-memory fixture, a virtual workspace, or a future editor buffer. This is the extraction
 * layer's only file-reading abstraction.
 */
export interface SourceReader {
  /** Reads UTF-8 source text for an absolute file path. */
  read(file: string): Promise<string>
}

/**
 * Source and syntax memo for one extraction pass.
 *
 * The memo prevents double reads/parses while extracting a file and its immediate static imports.
 * It is deliberately not shared across `extractFile(...)` calls: cross-pass AST reuse would make it
 * too easy to observe stale source after profile, extension, or source-reader changes.
 */
export interface ParseMemo {
  /** Returns source text, reusing the pass-local read promise when available. */
  readSource(file: string): Promise<string>
  /** Returns a TypeScript source file parsed from `readSource(file)`, memoized for this pass. */
  readSourceFile(file: string): Promise<ts.SourceFile>
}

/**
 * Creates the filesystem-backed source reader used by production extraction.
 *
 * The reader intentionally exposes only UTF-8 text reads. Directory traversal, globbing, and file
 * selection remain compiler responsibilities so tests can replace this layer with a tiny in-memory
 * map without changing extraction behavior.
 */
export function nodeSourceReader(): SourceReader {
  return Object.freeze({
    read: (file: string) => readFile(file, 'utf8'),
  })
}

/**
 * Creates a pass-local source and syntax memo over a source reader.
 *
 * The memo shares reads between cache-key construction, import analysis, and AST parsing for a single
 * `extractFile(...)` call. A new memo per file keeps editor buffers, custom source readers, and
 * extension/profile changes from leaking stale ASTs between extraction passes.
 */
export function createParseMemo(sources: SourceReader): ParseMemo {
  const sourceCache = new Map<string, Promise<string>>()
  const sourceFileCache = new Map<string, Promise<ts.SourceFile>>()
  return {
    readSource: (file) => {
      let source = sourceCache.get(file)
      if (!source) {
        source = sources.read(file)
        sourceCache.set(file, source)
      }
      return source
    },
    readSourceFile: (file) => {
      let sourceFile = sourceFileCache.get(file)
      if (!sourceFile) {
        sourceFile = (async () =>
          ts.createSourceFile(
            file,
            await readSourceFromCache(sourceCache, sources, file),
            ts.ScriptTarget.Latest,
            true,
          ))()
        sourceFileCache.set(file, sourceFile)
      }
      return sourceFile
    },
  }
}

/**
 * Reads source text through the shared promise cache used by both raw source and parsed AST access.
 *
 * The cache stores promises rather than resolved strings so concurrent import resolution in the same
 * pass coalesces to one source read.
 */
async function readSourceFromCache(
  sourceCache: Map<string, Promise<string>>,
  sources: SourceReader,
  file: string,
): Promise<string> {
  let source = sourceCache.get(file)
  if (!source) {
    source = sources.read(file)
    sourceCache.set(file, source)
  }
  return source
}
