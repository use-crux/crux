import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export interface SourceReader {
  read(file: string): Promise<string>
}

export interface ParseMemo {
  readSource(file: string): Promise<string>
  readSourceFile(file: string): Promise<ts.SourceFile>
}

export function nodeSourceReader(): SourceReader {
  return Object.freeze({
    read: (file: string) => readFile(file, 'utf8'),
  })
}

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
