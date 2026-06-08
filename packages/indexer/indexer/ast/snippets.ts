import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import ts from 'typescript'
import type { SourceLocation, SourceSnippet } from '@crux/core/project-index'

const MAX_SNIPPET_LENGTH = 12_000

export function sourceForNode(sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { file: sourceFile.fileName, line: pos.line + 1, column: pos.character + 1 }
}

export function sourceSnippetForNode(sourceFile: ts.SourceFile, node: ts.Node): SourceSnippet {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
  const source = node.getText(sourceFile)
  return {
    source: source.length > MAX_SNIPPET_LENGTH ? source.slice(0, MAX_SNIPPET_LENGTH) : source,
    language: languageForFile(sourceFile.fileName),
    range: {
      file: sourceFile.fileName,
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    },
    truncated: source.length > MAX_SNIPPET_LENGTH,
  }
}

export function sourceForFile(file: string): SourceLocation {
  return { file, line: 1, column: 1 }
}

export async function sourceSnippet(root: string, file: string): Promise<SourceSnippet | undefined> {
  try {
    const source = await readFile(file, 'utf8')
    const snippet = source.length > MAX_SNIPPET_LENGTH ? source.slice(0, MAX_SNIPPET_LENGTH) : source
    return {
      source: snippet,
      language: languageForFile(file),
      range: {
        file,
        startLine: 1,
        endLine: snippet.split('\n').length,
      },
      truncated: source.length > MAX_SNIPPET_LENGTH,
    }
  } catch {
    return {
      source: '',
      language: languageForFile(file),
      range: { file: resolve(root, file), startLine: 1 },
      truncated: true,
    }
  }
}

function languageForFile(file: string): string | undefined {
  switch (extname(file)) {
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.json':
      return 'json'
    default:
      return undefined
  }
}
