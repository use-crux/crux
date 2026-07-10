import { describe, expect, it } from 'vitest'
import { googleSettings } from '../src/request'

describe('Google request settings', () => {
  it('maps portable reasoning effort to Google thinking config', () => {
    expect(googleSettings({ reasoning: 'low' })).toMatchObject({
      thinkingConfig: { thinkingLevel: 'LOW' },
    })
    expect(googleSettings({ reasoning: 'low' })).not.toHaveProperty('reasoning')
  })
})
