import { describe, expect, it } from 'vitest'
import { nativeStaticAstSelectionFromConfig } from '../indexer/native-static-config'

describe('native static AST config selection', () => {
  it('keeps native static AST disabled by default and separate from semantic native', () => {
    expect(nativeStaticAstSelectionFromConfig(undefined)).toEqual({ enabled: false })
    expect(nativeStaticAstSelectionFromConfig({ indexer: { native: true } })).toEqual({ enabled: false })
    expect(nativeStaticAstSelectionFromConfig({ indexer: { native: { engine: 'tsgo' } } })).toEqual({
      enabled: false,
    })
  })

  it('selects the Rust/Oxc frontend from the sibling nativeAst experiment', () => {
    expect(nativeStaticAstSelectionFromConfig({ indexer: { nativeAst: true } })).toEqual({
      enabled: true,
      frontend: 'oxc',
    })
    expect(nativeStaticAstSelectionFromConfig({ indexer: { nativeAst: { frontend: 'oxc' } } })).toEqual({
      enabled: true,
      frontend: 'oxc',
    })
  })
})
