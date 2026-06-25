import { describe, expect, it } from 'vitest'
import { staticIndexSyntaxSelectionFromConfig } from '../indexer/static-index/config'

describe('Static Index syntax config selection', () => {
  it('keeps Static Index syntax disabled by default and separate from semantic native', () => {
    expect(staticIndexSyntaxSelectionFromConfig(undefined)).toEqual({ enabled: false })
    expect(staticIndexSyntaxSelectionFromConfig({ indexer: { native: true } })).toEqual({ enabled: false })
    expect(staticIndexSyntaxSelectionFromConfig({ indexer: { native: { engine: 'tsgo' } } })).toEqual({
      enabled: false,
    })
  })

  it('selects the Rust/Oxc frontend from the sibling nativeAst experiment', () => {
    expect(staticIndexSyntaxSelectionFromConfig({ indexer: { nativeAst: true } })).toEqual({
      enabled: true,
      frontend: 'oxc',
    })
    expect(staticIndexSyntaxSelectionFromConfig({ indexer: { nativeAst: { frontend: 'oxc' } } })).toEqual({
      enabled: true,
      frontend: 'oxc',
    })
  })
})
