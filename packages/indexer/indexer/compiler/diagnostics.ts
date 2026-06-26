import type { IndexDiagnostic, ProjectDefinition } from '@use-crux/core/project-index'

/**
 * Drops noisy rich-import failures for files where static indexing produced definitions.
 *
 * Runtime import attempts can fail for perfectly indexable authored files with side effects
 * or unavailable dependencies. Once the static pass has recovered definitions from that file,
 * this helper keeps the final diagnostics focused on actionable failures.
 */
export function suppressRichImportDiagnosticsForStaticDefinitions(
  diagnostics: readonly IndexDiagnostic[],
  definitions: readonly ProjectDefinition[],
): IndexDiagnostic[] {
  const definitionFiles = new Set(
    definitions
      .map((definitionItem) => definitionItem.source?.file)
      .filter((file): file is string => typeof file === 'string' && file.length > 0),
  )

  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 'index.rich_import_failed') return true
    const file = diagnostic.source?.file
    return !(file && definitionFiles.has(file))
  })
}
