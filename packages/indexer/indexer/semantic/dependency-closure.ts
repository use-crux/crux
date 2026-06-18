import { readFile } from 'node:fs/promises'
import { collectImportBindings } from '../ast/imports'
import { createSourceFile } from '../ast/parse'

export interface SemanticDependencyClosureOptions {
  /** Stop after this many local source files have been discovered. */
  readonly maxFiles?: number
  /** Stop after this many UTF-8 source bytes have been read. */
  readonly maxSourceBytes?: number
}

export interface SemanticDependencyClosure {
  /** Local source files reached from the selected semantic roots. */
  readonly files: readonly string[]
  /** UTF-8 bytes read before the closure completed or crossed a budget. */
  readonly sourceBytes: number
  /** Whether traversal completed without crossing a configured budget. */
  readonly complete: boolean
}

/**
 * Follows local imports from semantic roots before TypeScript program creation.
 *
 * The closure is intentionally fact-oriented: it counts files and bytes needed
 * for semantic enrichment without exposing TypeScript program or AST internals.
 */
export async function semanticDependencyClosure(
  root: string,
  files: readonly string[],
  options: SemanticDependencyClosureOptions = {},
): Promise<SemanticDependencyClosure> {
  const seen = new Set<string>()
  const queue = [...files].sort()
  let sourceBytes = 0
  let complete = true

  while (queue.length > 0) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue

    seen.add(file)
    if (options.maxFiles !== undefined && seen.size > options.maxFiles) {
      complete = false
      break
    }

    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }

    sourceBytes += Buffer.byteLength(source, 'utf8')
    if (options.maxSourceBytes !== undefined && sourceBytes > options.maxSourceBytes) {
      complete = false
      break
    }

    const sourceFile = createSourceFile(file, source)
    for (const dependency of collectImportBindings(sourceFile, root, file).values()) {
      if (!seen.has(dependency.file)) queue.push(dependency.file)
    }
    queue.sort()
  }

  return { files: [...seen].sort(), sourceBytes, complete }
}
