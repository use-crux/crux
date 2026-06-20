import type { IndexDiagnostic, ProjectDefinition } from '@crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { suppressRichImportDiagnosticsForStaticDefinitions } from '../indexer/compiler/diagnostics'

describe('project index compiler diagnostics', () => {
  it('suppresses rich import diagnostics once static indexing produced a definition for that source file', () => {
    const diagnostics: IndexDiagnostic[] = [
      diagnostic('index.rich_import_failed', '/project/src/writer.ts'),
      diagnostic('index.rich_import_failed', '/project/src/missing.ts'),
      diagnostic('index.source_only', '/project/crux.config.ts'),
    ]
    const definitions: ProjectDefinition[] = [
      {
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        fidelity: 'resolved',
        source: { file: '/project/src/writer.ts', line: 1 },
      },
    ]

    expect(suppressRichImportDiagnosticsForStaticDefinitions(diagnostics, definitions)).toEqual([
      diagnostics[1],
      diagnostics[2],
    ])
  })
})

function diagnostic(code: string, file: string): IndexDiagnostic {
  return {
    id: `${code}:${file}`,
    severity: 'warning',
    code,
    message: code,
    source: { file, line: 1 },
  }
}
