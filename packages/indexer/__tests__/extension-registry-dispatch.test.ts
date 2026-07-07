import { describe, expect, it } from 'vitest'
import { createExtensionRegistry, extractorsForCall } from '../indexer/extensions/runtime/registry'
import type { IndexerExtension } from '../indexer/extensions'

describe('extension registry dispatch', () => {
  it('dispatches call extractors by local and import-qualified names in registry order', () => {
    const registry = createExtensionRegistry([
      extension('@z/fallback', [
        extractor('z-any-workflow', [{ kind: 'call', name: 'workflow' }]),
        extractor('z-imported-workflow', [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }]),
      ]),
      extension('@a/workflows', [
        extractor('a-imported-workflow', [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }]),
      ]),
    ])

    const registered = extractorsForCall(registry, 'workflow', '@acme/workflows', 'defineWorkflow')

    expect(registered.map((item) => `${item.extension.name}/${item.extractor.name}`)).toEqual([
      '@a/workflows/a-imported-workflow',
      '@z/fallback/z-any-workflow',
      '@z/fallback/z-imported-workflow',
    ])
  })

  it('does not duplicate an extractor that declares multiple matching call patterns', () => {
    const registry = createExtensionRegistry([
      extension('@acme/workflows', [
        extractor('workflow', [
          { kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] },
          { kind: 'call', name: 'workflow' },
        ]),
      ]),
    ])

    const registered = extractorsForCall(registry, 'workflow', '@acme/workflows', 'defineWorkflow')

    expect(registered.map((item) => item.extractor.name)).toEqual(['workflow'])
  })

  it('does not dispatch import-qualified extractors for same-name local calls from another module', () => {
    const registry = createExtensionRegistry([
      extension('@acme/workflows', [
        extractor('workflow', [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }]),
      ]),
    ])

    expect(extractorsForCall(registry, 'defineWorkflow').map((item) => item.extractor.name)).toEqual([])
    expect(
      extractorsForCall(registry, 'defineWorkflow', '@other/workflows', 'defineWorkflow').map(
        (item) => item.extractor.name,
      ),
    ).toEqual([])
  })

  it('orders extensions and extractors by codepoint for cache-stable precedence', () => {
    const registry = createExtensionRegistry([
      extension('@scope/a', [
        extractor('á-extractor', [{ kind: 'call', name: 'defineThing' }]),
        extractor('Z-extractor', [{ kind: 'call', name: 'defineThing' }]),
      ]),
      extension('@scope/Z', [extractor('a-extractor', [{ kind: 'call', name: 'defineThing' }])]),
      extension('@scope/á', [extractor('a-extractor', [{ kind: 'call', name: 'defineThing' }])]),
    ])

    expect(registry.extensions.map((item) => item.name)).toEqual(['@scope/Z', '@scope/a', '@scope/á'])
    expect(extractorsForCall(registry, 'defineThing').map((item) => `${item.extension.name}/${item.extractor.name}`))
      .toEqual([
        '@scope/Z/a-extractor',
        '@scope/a/Z-extractor',
        '@scope/a/á-extractor',
        '@scope/á/a-extractor',
      ])
  })
})

function extension(name: string, extractors: IndexerExtension['extractors']): IndexerExtension {
  return {
    name,
    version: '1',
    extractors,
  }
}

function extractor(name: string, patterns: NonNullable<IndexerExtension['extractors']>[number]['patterns']) {
  return {
    name,
    patterns,
    extract: () => ({ kind: 'none' as const }),
  }
}
