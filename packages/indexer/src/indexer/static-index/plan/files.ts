import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { collectImportBindings } from '../../ast/imports'

/** Files selected for static syntax parsing and the helper-only records they need for parity. */
export interface StaticSyntaxPlanFileSelection {
  /** Files that can produce Project Index facts directly. */
  readonly primaryFiles: readonly string[]
  /** Resolved local imports parsed only as support evidence for record-backed extraction. */
  readonly supportFiles: readonly string[]
  /**
   * Resolved local import targets that must be available as syntax records.
   *
   * These files may include primary files. A primary file with a warm extraction
   * cache hit can still be needed as cross-file source-ref lookup evidence for
   * another primary file that must be extracted from fresh records.
   */
  readonly recordSupportFiles: readonly string[]
  /** Primary and support files, sorted and deduped for deterministic Static Index hosts. */
  readonly files: readonly string[]
}

/**
 * Expands primary static files with their resolved local import closure.
 *
 * Static syntax records are also the source-ref lookup table for record-backed
 * TypeScript extractors. Helper-only modules often have no Crux call sites, so
 * they are absent from normal candidate discovery while still being required to
 * resolve helper source refs exactly like the TypeScript AST path.
 */
export async function staticSyntaxPlanFileSelection(input: {
  readonly root: string
  readonly primaryFiles: readonly string[]
}): Promise<StaticSyntaxPlanFileSelection> {
  const primaryFiles = [...new Set(input.primaryFiles)].sort()
  const primaryFileSet = new Set(primaryFiles)
  const files = new Set(primaryFiles)
  const recordSupportFiles = new Set<string>()
  const queue = [...primaryFiles]

  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index]
    if (!file) continue
    const imports = await resolvedLocalImports(input.root, file)
    for (const importedFile of imports) {
      recordSupportFiles.add(importedFile)
      if (files.has(importedFile)) continue
      files.add(importedFile)
      queue.push(importedFile)
    }
  }

  const allFiles = [...files].sort()
  return {
    primaryFiles,
    supportFiles: allFiles.filter((file) => !primaryFileSet.has(file)),
    recordSupportFiles: [...recordSupportFiles].sort(),
    files: allFiles,
  }
}

async function resolvedLocalImports(root: string, file: string): Promise<readonly string[]> {
  try {
    const source = await readFile(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    return [...new Set([...collectImportBindings(sourceFile, root, file).values()].map((binding) => binding.file))]
      .sort()
  } catch {
    return []
  }
}
