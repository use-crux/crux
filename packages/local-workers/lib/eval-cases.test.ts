import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as core from '@use-crux/core/eval/internal/runner'
import { caseFile, evaluate } from '@use-crux/core/eval'
import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'
import { hydrateEvalCases, loadCaseRows } from './eval-cases'

const inputSchema = z.object({ question: z.string() })
const expectedSchema = z.object({ answer: z.string() })
const task = async (input: { question: string }) => input.question
const managedTask = attachEvalTaskDescriptorForInternalUse(task, {
  _tag: 'CruxEvalTaskDescriptor',
  operation: 'generate',
  adapterId: 'ai-sdk',
  inputSchema,
  capabilities: [],
  defaults: {},
  overrideKeys: [],
  projectIdentity: () => ({ reusable: false, reason: 'identity_unavailable' }),
  execute: async () => ({ value: 'unused' }),
  projectOutput: () => 'unused',
  projectResponse: () => ({
    content: [],
    text: 'unused',
    object: 'unused',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    steps: [],
    finalStep: {
      content: [],
      text: 'unused',
      finishReason: 'stop',
      responseId: 'response-1',
      modelId: 'fake',
      warnings: [],
    },
    messages: [],
    warnings: [],
  }),
})

describe('Eval Case files', () => {
  it('loads canonical sibling JSONL, validates input, and marks unvalidated expected evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-cases-'))
    const path = join(root, 'support.cases.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({
          schemaVersion: 1,
          id: 'review-1',
          input: { question: 'Refund?' },
          expected: { answer: 'Yes' },
          metadata: { source: 'review', reviewId: 'rev_1', runId: 'run_1', addedAt: '2026-07-16T00:00:00Z' },
        }),
        '',
      ].join('\n'),
      'utf8',
    )

    const rows = await loadCaseRows({ path, displayPath: 'evals/support.cases.jsonl', kind: 'sidecar', inputSchema, core })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'review-1',
      origin: 'evals/support.cases.jsonl:1',
      unvalidatedExpected: true,
      authored: { input: { question: 'Refund?' }, expected: { answer: 'Yes' } },
    })
    expect(rows[0]?.authored.unvalidatedExpected).toBe(true)
  })

  it('validates expected evidence when a schema carrier exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-expected-'))
    const path = join(root, 'cases.json')
    await writeFile(path, JSON.stringify([{ input: { question: 'Refund?' }, expected: { answer: 42 } }]), 'utf8')

    await expect(
      loadCaseRows({ path, displayPath: 'evals/cases.json', kind: 'authored', inputSchema, expectedSchema, core }),
    ).rejects.toThrow(/evals\/cases\.json:1.*expected.*string/i)
  })

  it('rejects duplicate ids after merging and names both origins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-duplicates-'))
    const path = join(root, 'support.cases.jsonl')
    await writeFile(
      path,
      `${JSON.stringify({ schemaVersion: 1, id: 'same', input: { question: 'A' }, metadata: { source: 'review', reviewId: 'r1', runId: 'run1', addedAt: 'now' } })}\n${JSON.stringify({ schemaVersion: 1, id: 'same', input: { question: 'B' }, metadata: { source: 'review', reviewId: 'r2', runId: 'run2', addedAt: 'now' } })}\n`,
      'utf8',
    )

    await expect(
      loadCaseRows({ path, displayPath: 'evals/support.cases.jsonl', kind: 'sidecar', inputSchema, core }),
    ).rejects.toThrow(/duplicate Case id 'same'.*:1.*:2/i)
  })

  it('merges the canonical sibling after inline Cases and materializes the derived id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-merge-'))
    await mkdir(join(root, 'evals'))
    await writeFile(join(root, 'evals', 'support.eval.ts'), '// fixture\n', 'utf8')
    const path = join(root, 'evals', 'support.cases.jsonl')
    await writeFile(
      path,
      `${JSON.stringify({ schemaVersion: 1, id: 'review', input: { question: 'B' }, metadata: { source: 'review', reviewId: 'r', runId: 'run', addedAt: 'now' } })}\n`,
      'utf8',
    )
    const evalValue = evaluate({ task: managedTask, cases: [{ id: 'inline', input: { question: 'A' } }] })

    const hydrated = await hydrateEvalCases(
      {
        id: 'support',
        eval: evalValue,
        sourceKey: { relativeFile: 'evals/support.eval.ts', export: 'default' },
        sidecarFile: 'evals/support.cases.jsonl',
        links: [],
      },
      { projectRoot: root, core },
    )

    expect(hydrated.cases.map((entry) => [entry.id, entry.origin])).toEqual([
      ['inline', 'evals/support.eval.ts:inline:1'],
      ['review', 'evals/support.cases.jsonl:1'],
    ])
    expect(hydrated.eval.id).toBe('support')
    expect(core.getEvalDefinitionForInternalUse(hydrated.eval).cases).toHaveLength(2)
  })

  it('preserves mixed source order and fingerprints the canonical Case-file path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-authored-'))
    await mkdir(join(root, 'evals', 'support', 'fixtures'), { recursive: true })
    const sourcePath = join(root, 'evals', 'support', 'support.eval.ts')
    await writeFile(sourcePath, "caseFile('./fixtures/../fixtures/refunds.json')\n")
    await writeFile(
      join(root, 'evals', 'support', 'fixtures', 'refunds.json'),
      JSON.stringify([{ id: 'file', input: { question: 'B' } }]),
    )
    const discovered = {
      id: 'support',
      sourceKey: { relativeFile: 'evals/support/support.eval.ts', export: 'default' as const },
      sidecarFile: 'evals/support/support.cases.jsonl',
      links: [],
    }
    const first = await hydrateEvalCases(
      {
        ...discovered,
        eval: evaluate({
          task: managedTask,
          cases: [
            { id: 'before', input: { question: 'A' } },
            caseFile('./fixtures/../fixtures/refunds.json', { input: inputSchema }),
            { id: 'after', input: { question: 'C' } },
          ],
        }),
      },
      { projectRoot: root, core },
    )

    await writeFile(sourcePath, "caseFile('./fixtures/refunds.json')\n")
    const second = await hydrateEvalCases(
      {
        ...discovered,
        eval: evaluate({
          task: managedTask,
          cases: [
            { id: 'before', input: { question: 'A' } },
            caseFile('./fixtures/refunds.json', { input: inputSchema }),
            { id: 'after', input: { question: 'C' } },
          ],
        }),
      },
      { projectRoot: root, core },
    )

    expect(first.cases.map((entry) => entry.id)).toEqual(['before', 'file', 'after'])
    expect(first.cases[1]?.origin).toBe('evals/support/fixtures/refunds.json:1')
    expect(first.caseFileDependencies).toEqual(['evals/support/fixtures/refunds.json'])
    expect(second.definitionFingerprint).toBe(first.definitionFingerprint)
  })

  it('rejects an opaque task as a pre-execution discovery error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-eval-opaque-'))
    await mkdir(join(root, 'evals'))
    await writeFile(join(root, 'evals', 'opaque.eval.ts'), '// fixture\n', 'utf8')
    const opaqueTask = async (input: { question: string }) => input.question
    const opaque = evaluate({ task: opaqueTask, cases: [{ input: { question: 'A' } }] })

    await expect(
      hydrateEvalCases(
        {
          id: 'opaque',
          eval: opaque,
          sourceKey: { relativeFile: 'evals/opaque.eval.ts', export: 'default' },
          sidecarFile: 'evals/opaque.cases.jsonl',
          links: [],
        },
        { projectRoot: root, core },
      ),
    ).rejects.toThrow(/managed task created with generate\.task\(\) or stream\.task\(\)/i)
  })
})
