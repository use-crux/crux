import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Reads a repository Markdown or MDX document for release-readiness contract
 * checks. These tests keep the beta docs aligned with the executable gate
 * instead of letting readiness notes drift from CI.
 */
function readRepoDoc(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8')
}

describe('native AST beta readiness docs', () => {
  it('documents the beta gate, release checks, extension fallback, and default-readiness criteria', async () => {
    const [readiness, publishing, indexerReference, configReference, projectIndexReference] = await Promise.all([
      readRepoDoc('docs/NATIVE_AST_BETA_READINESS.md'),
      readRepoDoc('docs/PUBLISHING.md'),
      readRepoDoc('apps/docs/content/docs/reference/indexer.mdx'),
      readRepoDoc('apps/docs/content/docs/reference/crux-core/config.mdx'),
      readRepoDoc('apps/docs/content/docs/reference/crux-core/project-index.mdx'),
    ])

    expect(readiness).toContain('pnpm test:native-ast-parity')
    expect(readiness).toMatch(/files=\d+ matched=\d+ canonicalMismatches=0/)
    expect(readiness).toContain('29 built-in lint rules')
    expect(readiness).toContain('17 first-party extractor families')
    expect(readiness).toContain('TypeScript extension fallback')
    expect(readiness).toContain('Default-readiness checklist')

    expect(publishing).toContain('Native AST beta parity')
    expect(publishing).toContain('pnpm test:native-ast-parity')
    expect(publishing).toContain('make local')

    for (const source of [indexerReference, configReference, projectIndexReference]) {
      expect(source).toContain('experimental.indexer.nativeAst')
      expect(source).toContain('Rust/Oxc')
      expect(source).toContain('TypeScript extension')
    }

    expect(indexerReference).toContain('Node can still start')
    expect(configReference).toContain('native AST beta gate')
    expect(projectIndexReference).toContain('fallback or Node-start diagnostics')
  })
})
