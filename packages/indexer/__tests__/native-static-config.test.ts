import { describe, expect, it } from 'vitest'
import { staticIndexSyntaxSelectionFromConfig } from '../src/indexer/static-index/config'

describe('Static Index syntax config selection', () => {
  it('keeps Static Index syntax disabled by default and separate from semantic native', () => {
    expect(staticIndexSyntaxSelectionFromConfig(undefined)).toEqual({
      configured: false,
      enabled: false,
    })
    expect(
      staticIndexSyntaxSelectionFromConfig({ indexer: { native: true } }),
    ).toEqual({
      configured: false,
      enabled: false,
    })
    expect(
      staticIndexSyntaxSelectionFromConfig({
        indexer: { native: { engine: 'tsgo' } },
      }),
    ).toEqual({
      configured: false,
      enabled: false,
    })
    expect(
      staticIndexSyntaxSelectionFromConfig({ indexer: { nativeAst: false } }),
    ).toEqual({
      configured: true,
      enabled: false,
    })
  })

  it('selects the Rust/Oxc frontend from the sibling nativeAst experiment', () => {
    expect(
      staticIndexSyntaxSelectionFromConfig({ indexer: { nativeAst: true } }),
    ).toEqual({
      configured: true,
      enabled: true,
      frontend: 'oxc',
    })
    expect(
      staticIndexSyntaxSelectionFromConfig({
        indexer: { nativeAst: { frontend: 'oxc' } },
      }),
    ).toEqual({
      configured: true,
      enabled: true,
      frontend: 'oxc',
    })
  })
})
