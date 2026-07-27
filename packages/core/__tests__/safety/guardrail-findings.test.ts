import { describe, expect, it } from 'vitest'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  SafetyResultError,
  type SafetyFinding,
  type SafetyOutput,
} from '../../src/safety'
import { freezeSafetyAudit } from '../../src/safety/audit'

const noRegeneration = async (): Promise<SafetyOutput> => {
  throw new Error('regeneration must not run')
}

const userMessage = (content: string) => ({ role: 'user' as const, content })

describe('guardrail callback findings', () => {
  it('preserves text-classifier findings through the public non-stream audit', async () => {
    const policy = guardrail({
      id: 'text-classifier',
      on: boundary.output.text(),
      mode: 'report',
      run: guardrail.classifier({
        classifier: () => ({ unsafe: true }),
        blockWhen: (result) => result.unsafe,
        findings: () => [{ type: 'classifier_match', count: 1 }],
        reason: 'Classifier matched.',
      }),
    })
    const safety = createSafety({
      promptId: 'prompt-1',
      model: 'model-1',
      call: { guardrails: [policy] },
    })

    await safety.finalizeOutput(
      { text: 'protected output' },
      noRegeneration,
    )

    expect(safety.audit.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'text-classifier',
        action: 'block',
        findings: [{ type: 'classifier_match', count: 1 }],
      }),
    ])
  })

  it('uses an isolated collector for each invocation and retains add order', async () => {
    const collectors: unknown[] = []
    let invocation = 0
    const policy = guardrail({
      id: 'isolated-findings',
      on: boundary.input.text(),
      run: (_subject, ctx) => {
        invocation += 1
        collectors.push(ctx.findings)
        ctx.findings.add({ type: `first-${invocation}` })
        ctx.findings.add({ type: `second-${invocation}` })
        return { action: 'allow' }
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    await safety.guardInput({
      messages: [userMessage('one'), userMessage('two')],
    })

    expect(collectors).toHaveLength(2)
    expect(collectors[0]).not.toBe(collectors[1])
    expect(safety.audit.guardrails?.applied.map((entry) => entry.findings))
      .toEqual([
        [{ type: 'first-1' }, { type: 'second-1' }],
        [{ type: 'first-2' }, { type: 'second-2' }],
      ])
    expect(safety.audit.guardrails?.applied[0]?.findings).not.toBe(
      safety.audit.guardrails?.applied[1]?.findings,
    )
  })

  it('merges detached collector findings before detached rewrite findings', async () => {
    const collectorFinding = {
      type: 'collector',
      category: 'unsafe',
      score: 0.9,
      threshold: 0.8,
      span: { start: 1, end: 3 },
      privateField: 'drop-me',
    }
    const resultFinding = {
      type: 'result',
      count: 2,
      privateField: 'drop-me-too',
    }
    const policy = guardrail({
      id: 'merged-findings',
      on: boundary.output.text(),
      run: (subject, ctx) => {
        ctx.findings.add(collectorFinding)
        return {
          action: 'rewrite',
          value: subject.toUpperCase(),
          rewrite: { kind: 'normalize' },
          findings: [resultFinding],
        }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
    })

    await safety.finalizeOutput({ text: 'safe' }, noRegeneration)
    collectorFinding.category = 'mutated'
    collectorFinding.span.end = 99
    resultFinding.count = 99

    const findings = safety.audit.guardrails?.applied[0]?.findings
    expect(findings).toEqual([
      {
        type: 'collector',
        category: 'unsafe',
        score: 0.9,
        threshold: 0.8,
        span: { start: 1, end: 3 },
      },
      { type: 'result', count: 2 },
    ])
    expect([
      findings,
      findings?.[0],
      findings?.[0]?.span,
      findings?.[1],
    ].every(Object.isFrozen)).toBe(true)
  })

  it.each([
    ['empty type', { type: '' }],
    ['negative count', { type: 'x', count: -1 }],
    ['fractional count', { type: 'x', count: 1.5 }],
    ['negative span start', { type: 'x', span: { start: -1, end: 2 } }],
    ['fractional span end', { type: 'x', span: { start: 0, end: 1.5 } }],
    ['reversed span', { type: 'x', span: { start: 2, end: 1 } }],
    ['empty category', { type: 'x', category: '' }],
    ['NaN score', { type: 'x', score: Number.NaN }],
    ['negative score', { type: 'x', score: -0.1 }],
    ['score above one', { type: 'x', score: 1.1 }],
    ['infinite threshold', { type: 'x', threshold: Infinity }],
    ['threshold above one', { type: 'x', threshold: 1.1 }],
  ])('rejects invalid collector finding: %s', async (_name, finding) => {
    const policy = guardrail({
      id: 'invalid-finding',
      on: boundary.input.text(),
      run: (_subject, ctx) => {
        ctx.findings.add(finding as SafetyFinding)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    await expect(
      safety.guardInput({ messages: [userMessage('input')] }),
    ).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-finding',
      boundary: 'model.input.text',
    })
  })

  it('rejects malformed rewrite-result findings through the same validator', async () => {
    const policy = guardrail({
      id: 'invalid-result-finding',
      on: boundary.output.text(),
      run: (() => ({
        action: 'rewrite',
        value: 'rewritten',
        rewrite: { kind: 'normalize' },
        findings: [{ type: 'bad-score', score: 2 }],
      })) as never,
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    await expect(
      safety.finalizeOutput({ text: 'input' }, noRegeneration),
    ).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-result-finding',
      boundary: 'model.output.text',
    })
  })

  it('publishes no partial findings when the policy throws', async () => {
    const sentinel = new Error('policy failed')
    const policy = guardrail({
      id: 'throw-after-finding',
      on: boundary.input.text(),
      run: (_subject, ctx) => {
        ctx.findings.add({ type: 'must-not-publish' })
        throw sentinel
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    await expect(
      safety.guardInput({ messages: [userMessage('input')] }),
    ).rejects.toBe(sentinel)
    expect(safety.audit.guardrails?.applied ?? []).toEqual([])
  })

  it('preserves media findings in the audit and terminal decision', async () => {
    const policy = guardrail({
      id: 'media-finding-block',
      on: boundary.input.media(),
      run: (_subject, ctx) => {
        ctx.findings.add({
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.9,
          threshold: 0.8,
        })
        return { action: 'block', reason: 'Unsafe media.' }
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    const error = await safety
      .guardInput({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: new Uint8Array([1]) }],
          },
        ],
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    const expected = [{
      type: 'media_classifier_match',
      category: 'unsafe',
      score: 0.9,
      threshold: 0.8,
    }]
    expect(safety.audit.guardrails?.applied[0]?.findings).toEqual(expected)
    expect((error as GuardrailBlockedError).decisions[0]?.findings).toEqual(
      expected,
    )
  })

  it('detaches and deeply freezes findings in a public audit snapshot', () => {
    const finding = {
      type: 'media_classifier_match',
      category: 'unsafe',
      score: 0.9,
      threshold: 0.8,
      span: { start: 0, end: 1 },
    }
    const frozen = freezeSafetyAudit({
      guardrails: {
        applied: [{
          guard: 'snapshot',
          boundary: 'model.output.text',
          mode: 'enforce',
          phase: 'output',
          action: 'block',
          findings: [finding],
          durationMs: 1,
        }],
        blocked: true,
      },
    })

    finding.category = 'mutated'
    finding.span.end = 99
    expect(frozen.guardrails?.applied[0]?.findings?.[0]).toMatchObject({
      category: 'unsafe',
      span: { start: 0, end: 1 },
    })
    expect([
      frozen,
      frozen.guardrails,
      frozen.guardrails?.applied,
      frozen.guardrails?.applied[0],
      frozen.guardrails?.applied[0]?.findings,
      frozen.guardrails?.applied[0]?.findings?.[0],
      frozen.guardrails?.applied[0]?.findings?.[0]?.span,
    ].every(Object.isFrozen)).toBe(true)
  })
})
