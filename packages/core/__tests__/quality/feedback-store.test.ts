import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFeedbackStore } from '../../quality/internal/feedback'

describe('quality internal feedback store', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeStore(redact: readonly string[] = []) {
    const dir = await mkdtemp(join(tmpdir(), 'crux-feedback-store-'))
    tempDirs.push(dir)
    return { dir, store: createFeedbackStore({ qualityId: 'support-quality', dir, redact }) }
  }

  it('records and lists feedback newest-first with the JSONL on-disk format', async () => {
    const { dir, store } = await makeStore()
    const first = await store.record({ caseId: 'case-1', rating: -1, comment: 'Missed the policy.' })
    const second = await store.record({ caseId: 'case-2', rating: 1 })

    const listed = await store.list()
    expect(listed.map((record) => record.id)).toEqual([second.id, first.id])
    expect(listed[1]).toMatchObject({ _tag: 'QualityFeedback', qualityId: 'support-quality', status: 'new', rating: -1 })

    const raw = await readFile(join(dir, 'feedback', 'inbox.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(2)
  })

    it('annotates existing feedback and rejects unknown ids', async () => {
    const { store } = await makeStore()
    const record = await store.record({ caseId: 'case-1' })

    const annotation = await store.annotate({ feedbackId: record.id, status: 'reviewed', note: 'Confirmed.' })
    expect(annotation).toMatchObject({ _tag: 'QualityFeedbackAnnotation', feedbackId: record.id, status: 'reviewed' })
    expect(await store.listAnnotations(record.id)).toHaveLength(1)

    await expect(store.annotate({ feedbackId: 'feedback-nope' })).rejects.toThrow('was not found')
  })

    it('stores memory proposals linked to feedback', async () => {
    const { store } = await makeStore()
    const record = await store.record({ caseId: 'case-1' })

    const proposal = await store.proposeMemory({
      feedbackId: record.id,
      memoryKind: 'fact',
      proposal: { statement: 'Refunds take 14 days.' },
    })
    expect(proposal).toMatchObject({ _tag: 'QualityFeedbackMemoryProposal', status: 'proposed', feedbackId: record.id })
    expect(await store.listMemoryProposals(record.id)).toHaveLength(1)
  })

    it('exports a portable suite from selected feedback with provided inputs', async () => {
    const { store } = await makeStore()
    const record = await store.record({ caseId: 'refund-answer', expected: { answer: 'yes' }, tags: ['citation'] })

    const portable = await store.exportSuite({
      id: 'from-feedback',
      feedbackIds: [record.id],
      inputs: { [record.id]: { question: 'Refund?' } },
      tag: 'triage',
      includeFeedbackMetadata: true,
    })
    expect(portable.id).toBe('from-feedback')
    expect(portable.cases).toHaveLength(1)
    expect(portable.cases[0]).toMatchObject({
      id: 'refund-answer',
      input: { question: 'Refund?' },
      expected: { answer: 'yes' },
      tags: ['citation', 'triage'],
      metadata: { qualityFeedbackId: record.id },
    })

    await expect(store.exportSuite({ id: 'missing-input', feedbackIds: [record.id] })).rejects.toThrow('has no input')
  })

    it('applies dot-path redaction at write time', async () => {
    const { store } = await makeStore(['metadata.apiKey'])
    const record = await store.record({ caseId: 'case-1', metadata: { apiKey: 'secret', model: 'gpt' } })
    expect(record.metadata).toEqual({ apiKey: '[redacted]', model: 'gpt' })
  })
})
