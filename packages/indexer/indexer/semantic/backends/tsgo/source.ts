import type { Node, SourceFile } from '@typescript/native-preview/unstable/ast'
import type { SourceLocation, SourceSnippet } from '@use-crux/core/project-index'

const MAX_SNIPPET_LENGTH = 12_000

export interface NativeSourceRange {
  readonly start: number
  readonly end: number
}

export function nativeSourceForNode(sourceFile: SourceFile, node: Node): SourceLocation {
  const start = nativeNodeStart(sourceFile, node)
  const position = nativeLineAndColumn(sourceFile, start)
  return { file: sourceFile.fileName, line: position.line, column: position.column }
}

export function nativeSourceSnippetForNode(sourceFile: SourceFile, node: Node): SourceSnippet {
  const range = nativeNodeRange(sourceFile, node)
  const source = sourceFile.text.slice(range.start, range.end)
  const snippet = source.length > MAX_SNIPPET_LENGTH ? source.slice(0, MAX_SNIPPET_LENGTH) : source
  const start = nativeLineAndColumn(sourceFile, range.start)
  const end = nativeLineAndColumn(sourceFile, range.end)
  return {
    source: snippet,
    language: languageForFile(sourceFile.fileName),
    range: {
      file: sourceFile.fileName,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    truncated: source.length > MAX_SNIPPET_LENGTH,
  }
}

export function nativeNodeRange(sourceFile: SourceFile, node: Node): NativeSourceRange {
  return { start: nativeNodeStart(sourceFile, node), end: node.end }
}

export function nativeNodeStart(sourceFile: SourceFile, node: Node): number {
  return skipTrivia(sourceFile.text, node.pos)
}

export function nativeLineAndColumn(sourceFile: SourceFile, position: number): { readonly line: number; readonly column: number } {
  const text = sourceFile.text
  let line = 1
  let lineStart = 0
  for (let index = 0; index < position; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: position - lineStart + 1 }
}

export function nativeNodeText(sourceFile: SourceFile, node: Node): string {
  const range = nativeNodeRange(sourceFile, node)
  return sourceFile.text.slice(range.start, range.end)
}

/** Materializes native-preview node lists before using JavaScript array operators. */
export function nativeNodeList<TNode>(nodes: Iterable<TNode> | ArrayLike<TNode>): readonly TNode[] {
  return Array.from(nodes)
}

function skipTrivia(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text.charCodeAt(index)
    if (char === 32 || char === 9 || char === 10 || char === 13) {
      index += 1
      continue
    }
    if (text.startsWith('//', index)) {
      const nextLine = text.indexOf('\n', index + 2)
      index = nextLine === -1 ? text.length : nextLine + 1
      continue
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    return index
  }
  return index
}

function languageForFile(file: string): string | undefined {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript'
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return 'javascript'
  if (file.endsWith('.json')) return 'json'
  return undefined
}
