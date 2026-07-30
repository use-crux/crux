import { describe, expect, it } from 'vitest'
import { PromptTextPreviewLanguageTransitions } from './language-transition.js'

describe('PromptTextPreviewLanguageTransitions', () => {
  it('suppresses only one matching synthetic close/open pair', () => {
    const transitions = new PromptTextPreviewLanguageTransitions()
    transitions.begin('crux-prompt-preview:/one.md?slot=1')

    expect(transitions.closed('crux-prompt-preview:/one.md?slot=1')).toBe(
      'ignore',
    )
    expect(transitions.opened('crux-prompt-preview:/one.md?slot=1')).toBe(true)
    expect(
      transitions.complete(
        'crux-prompt-preview:/one.md?slot=1',
        'crux-prompt-preview:/one.md?slot=1',
        'markdown',
      ),
    ).toBe(true)
    transitions.finish('crux-prompt-preview:/one.md?slot=1')
    expect(transitions.closed('crux-prompt-preview:/one.md?slot=1')).toBe(
      'dispose',
    )
  })

  it('fails closed on another URI, wrong language, or a second close', () => {
    const transitions = new PromptTextPreviewLanguageTransitions()
    transitions.begin('crux-prompt-preview:/one.md?slot=1')
    expect(
      transitions.complete(
        'crux-prompt-preview:/one.md?slot=1',
        'crux-prompt-preview:/two.md?slot=2',
        'markdown',
      ),
    ).toBe(false)
    expect(
      transitions.complete(
        'crux-prompt-preview:/one.md?slot=1',
        'crux-prompt-preview:/one.md?slot=1',
        'plaintext',
      ),
    ).toBe(false)
    expect(transitions.closed('crux-prompt-preview:/one.md?slot=1')).toBe(
      'ignore',
    )
    expect(transitions.closed('crux-prompt-preview:/one.md?slot=1')).toBe(
      'dispose',
    )
  })

  it('requires the matching synthetic close and open before completion', () => {
    const uri = 'crux-prompt-preview:/one.md?slot=1'
    const transitions = new PromptTextPreviewLanguageTransitions()
    transitions.begin(uri)

    expect(transitions.complete(uri, uri, 'markdown')).toBe(false)
    expect(transitions.closed(uri)).toBe('ignore')
    expect(transitions.complete(uri, uri, 'markdown')).toBe(false)
    expect(transitions.opened(uri)).toBe(true)
    expect(transitions.complete(uri, uri, 'markdown')).toBe(true)
  })
})
