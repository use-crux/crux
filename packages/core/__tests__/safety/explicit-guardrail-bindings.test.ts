/**
 * Regression coverage for exact registry bindings as observed through the
 * public per-call safety session.
 */

import { describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'
import type { TextInputSource } from '../../src/safety'

describe('createSafety — exact guardrail bindings', () => {
  it('normalizes and freezes explicit source selectors without materializing defaults', () => {
    const defaultBoundary = boundary.input.text()
    const filteredBoundary = boundary.input.text({
      from: ['tool', 'user', 'tool'] as const,
    })

    expect(defaultBoundary).not.toHaveProperty('from')
    expect(filteredBoundary.from).toEqual(['tool', 'user'])
    expect(Object.isFrozen(filteredBoundary)).toBe(true)
    expect(Object.isFrozen(filteredBoundary.from)).toBe(true)
  })

  it('rejects a dynamically empty source selector', () => {
    const sources: readonly TextInputSource[] = []

    expect(() => boundary.input.text({ from: sources })).toThrow(/cannot be empty/i)
  })

  it('guards trusted system content only through the instructions boundary', async () => {
    const seen: string[] = []
    const instructions = guardrail({
      id: 'trusted-instructions',
      on: boundary.input.instructions(),
      run: (content) => {
        seen.push(content)
        return {
          action: 'rewrite',
          value: content.replace('private', '[redacted]'),
          rewrite: { kind: 'redact' },
        }
      },
    })
    const user = guardrail({
      id: 'untrusted-text',
      on: boundary.input.text(),
      run: (content) => {
        seen.push(`user:${content}`)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({ call: { guardrails: [instructions, user] } })

    const result = await safety.guardInput({
      system: 'private flat instruction',
      messages: [
        { role: 'system', content: 'private message instruction' },
        { role: 'user', content: 'hello' },
      ],
    })

    expect(result.system).toBe('[redacted] flat instruction')
    expect(result.messages).toEqual([
      { role: 'system', content: '[redacted] message instruction' },
      { role: 'user', content: 'hello' },
    ])
    expect(seen).toEqual(['user:hello', 'private flat instruction', 'private message instruction'])
  })

  it('matches explicit text selectors before invoking a policy', async () => {
    const seen: string[] = []
    const userPolicy = guardrail({
      id: 'selected-user-input',
      on: boundary.input.text({ from: 'user' }),
      run: (_subject, context) => {
        seen.push(context.origin.source)
        return { action: 'allow' }
      },
    })
    const toolPolicy = guardrail({
      id: 'selected-tool-input',
      on: boundary.input.text({ from: 'tool' }),
      run: () => {
        seen.push('unexpected-tool')
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [userPolicy, toolPolicy] },
    })

    await safety.guardInput({ messages: [{ role: 'user', content: 'input' }] })

    expect(seen).toEqual(['user'])
  })

  it('dispatches semantic user origin to an unfiltered text boundary', async () => {
    const origins: unknown[] = []
    const policy = guardrail({
      id: 'semantic-user-input',
      on: boundary.input.text(),
      run: (_subject, context) => {
        origins.push(context.origin)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({ messages: [{ role: 'user', content: 'input' }] })

    expect(origins).toEqual([{ source: 'user', kind: 'message', messageIndex: 0 }])
  })

  it('runs and audits each boundary of an input/output text tuple exactly', async () => {
    const boundaries: string[] = []
    const policy = guardrail({
      id: 'input-output-policy',
      on: [boundary.input.text(), boundary.output.text()] as const,
      mode: 'report',
      run: (_subject, context) => {
        boundaries.push(context.boundary.id)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({ messages: [{ role: 'user', content: 'input' }] })
    await safety.finalizeOutput({ text: 'output' }, async () => {
      throw new Error('regeneration must not run')
    })

    expect(boundaries).toEqual(['model.input.text', 'model.output.text'])
    expect(safety.audit.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'input-output-policy',
        boundary: 'model.input.text',
        mode: 'report',
        phase: 'input',
      }),
      expect.objectContaining({
        guard: 'input-output-policy',
        boundary: 'model.output.text',
        mode: 'report',
        phase: 'output',
      }),
    ])
  })

  it('streams with the exact output binding and its tuned posture', async () => {
    const seen: Array<{ readonly boundary: string; readonly mode: string }> = []
    const policy = guardrail({
      id: 'stream-tuple-policy',
      on: [boundary.input.text(), boundary.output.text()] as const,
      stream: 'chunk',
      run: (subject, context) => {
        seen.push({ boundary: context.boundary.id, mode: context.policy.mode })
        return {
          action: 'rewrite',
          value: `${subject}-rewritten`,
          rewrite: { kind: 'normalize' },
        }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
      safety: { tune: { 'stream-tuple-policy': { mode: 'report' } } },
    })

    const stream = safety.openStream()
    expect(await stream.feed('output')).toEqual({
      kind: 'emit',
      content: 'output',
    })

    expect(seen).toEqual([{ boundary: 'model.output.text', mode: 'report' }])
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'stream-tuple-policy',
        boundary: 'model.output.text',
        mode: 'report',
        phase: 'output',
        action: 'transform',
      }),
    )
  })
})
