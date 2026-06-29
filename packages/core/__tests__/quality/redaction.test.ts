import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { createFeedbackStore } from '../../quality/internal/feedback'
import { runEvaluationWithRunner as run } from './runner-harness'

describe('quality redaction contract', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeFeedbackStore(redact: readonly string[] = []) {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-redaction-'))
    tempDirs.push(dir)
    return createFeedbackStore({ qualityId: 'support-quality', dir, redact })
  }

  it('always redacts authorization and API-key fields from feedback payloads at every depth', async () => {
    const store = await makeFeedbackStore()

    const record = await store.record({
      caseId: 'case-1',
      expected: {
        answer: 'ok',
        headers: { authorization: 'Bearer expected' },
      },
      metadata: {
        request: {
          apiKey: 'sk-metadata',
          attempts: [{ headers: { 'x-api-key': 'sk-nested' } }],
        },
      },
    })
    const proposal = await store.proposeMemory({
      feedbackId: record.id,
      proposal: {
        statement: 'Refunds take 14 days.',
        transport: { proxyAuthorization: 'Basic proposal' },
      },
    })

    expect(record.expected).toEqual({
      answer: 'ok',
      headers: { authorization: '[redacted]' },
    })
    expect(record.metadata).toEqual({
      request: {
        apiKey: '[redacted]',
        attempts: [{ headers: { 'x-api-key': '[redacted]' } }],
      },
    })
    expect(proposal.proposal).toEqual({
      statement: 'Refunds take 14 days.',
      transport: { proxyAuthorization: '[redacted]' },
    })
  })

  it('applies configured dot paths relative to each evaluation cell snapshot value', async () => {
    const evaluation = evaluate({
      task: async (input: { customer: { email: string; id: string } }) => ({
        customer: { email: input.customer.email, id: input.customer.id },
      }),
      data: [
        {
          input: { customer: { email: 'customer@example.com', id: 'cust_123' } },
          expected: { customer: { email: 'expected@example.com', id: 'cust_123' } },
        },
      ],
    })

    const experiment = await run(evaluation, undefined, { redact: ['customer.email'] })
    const cell = experiment.perCase[0]!

    expect(cell.input).toEqual({ customer: { email: '[redacted]', id: 'cust_123' } })
    expect(cell.output).toEqual({ customer: { email: '[redacted]', id: 'cust_123' } })
    expect(cell.expected).toEqual({ customer: { email: '[redacted]', id: 'cust_123' } })
  })

  it('scopes configured feedback redaction paths by metadata, expected, and proposal roots', async () => {
    const store = await makeFeedbackStore([
      'metadata.customer.email',
      'expected.answer.privateNote',
      'proposal.entries.secret',
    ])

    const record = await store.record({
      caseId: 'case-1',
      expected: {
        answer: { text: 'ok', privateNote: 'internal expected note' },
        customer: { email: 'expected@example.com' },
      },
      metadata: {
        customer: { email: 'customer@example.com', id: 'cust_123' },
        answer: { privateNote: 'metadata note stays because expected.* is scoped' },
      },
    })
    const proposal = await store.proposeMemory({
      feedbackId: record.id,
      proposal: {
        entries: [
          { secret: 'one', value: 'visible one' },
          { secret: 'two', value: 'visible two' },
        ],
      },
    })

    expect(record.metadata).toEqual({
      customer: { email: '[redacted]', id: 'cust_123' },
      answer: { privateNote: 'metadata note stays because expected.* is scoped' },
    })
    expect(record.expected).toEqual({
      answer: { text: 'ok', privateNote: '[redacted]' },
      customer: { email: 'expected@example.com' },
    })
    expect(proposal.proposal).toEqual({
      entries: [
        { secret: '[redacted]', value: 'visible one' },
        { secret: '[redacted]', value: 'visible two' },
      ],
    })
  })
})
