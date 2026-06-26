import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('first-party Phase 5 native fixtures', () => {
  itWithRustOxc(
    'emits exact native workspace facts from Rust/Oxc records',
    async () => {
      const source = [
        "const searchDocs = createTool({ name: 'searchDocs' })",
        '',
        'export const scratch = workspace({',
        "  id: 'scratch',",
        "  namespace: 'tenant-a',",
        '  tools: { searchDocs },',
        "  mounts: [{ path: '/workspace', access: 'write', description: 'Draft files' }],",
        '  storage: blobStore,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['workspace'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(1)
      expect(record.nativeFacts?.[0]?.replaces).toEqual([
        { extension: '@use-crux/indexer/crux-core', extractor: 'workspace' },
      ])
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'matches workspace tool-only intelligence metadata',
    async () => {
      const source = [
        "const searchDocs = createTool({ name: 'searchDocs' })",
        '',
        'export const scratchPad = workspace({',
        '  tools: { searchDocs },',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['workspace'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'matches property-access workspace calls without config objects',
    async () => {
      const source = [
        'const qk = { workspaces: { workspace: (id: string) => ["workspace", id] } }',
        '',
        'export function useWorkspace(workspaceId: string) {',
        '  const key = qk.workspaces.workspace(workspaceId)',
        '  return key',
        '}',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['workspace'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native safety facts from Rust/Oxc records',
    async () => {
      const source = [
        "const writerPrompt = prompt({ id: 'writer' })",
        'const validateTone = () => true',
        'const runGuardrail = () => true',
        '',
        'export const safeTone = constraint({',
        "  name: 'safe-tone',",
        "  severity: 'high',",
        '  appliesTo: writerPrompt,',
        '  validate: validateTone,',
        '})',
        '',
        'export const outputGuard = guardrail({',
        "  name: 'output-guard',",
        "  phase: 'output',",
        "  targets: ['prompt:writer'],",
        '  run: runGuardrail,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'constraint', 'guardrail'],
      })

      expect(nativeFactCount(record, 'safety')).toBe(2)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native scorer facts from Rust/Oxc records',
    async () => {
      const longCriteria = `${'A'.repeat(241)}`
      const source = [
        "const modelId = 'gpt-test'",
        'const scoreAnswer = () => 1',
        '',
        'export const relevanceJudge = llmJudge({',
        "  id: 'relevance',",
        '  model: modelId,',
        '  threshold: 0.75,',
        '  temperature: 0.1,',
        '  samples: 3,',
        '  scale: { min: 0, max: 1 },',
        '  rubric: { answer: true },',
        '  detailSchema: { score: "number" },',
        '  chainOfThought: false,',
        `  criteria: '${longCriteria}',`,
        '  settings: { topP: 0.8, strict: true },',
        '  score: scoreAnswer,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['llmJudge'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native RAG retriever and pipeline facts from Rust/Oxc records',
    async () => {
      const source = [
        "export const docsRetriever = retriever({ id: 'docs', namespace: 'public' })",
        '',
        'export const docsRag = retrievalPipeline(docsRetriever, [',
        "  { name: 'lookup', retriever: docsRetriever },",
        '])',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['retriever', 'retrievalPipeline'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(2)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native registry and registry skill facts from Rust/Oxc records',
    async () => {
      const source = [
        "const registryAuth = () => 'token'",
        '',
        'export const acme = registry({',
        "  name: 'acme',",
        "  baseUrl: 'https://skills.acme.test',",
        '  auth: registryAuth,',
        '})',
        '',
        "export const brand = skill.fromRegistry(acme, 'brand-guidelines')",
        "export const seo = skill.fromRegistry(skillsSh, 'owner/repo/seo')",
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['registry', 'fromRegistry'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(3)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native eval facts from Rust/Oxc records',
    async () => {
      const source = [
        "export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        '',
        "export const writerEval = evaluate('prompt.writer', {",
        '  task: writerPrompt,',
        "  data: [{ name: 'draft title', input: {}, expect: async (ctx) => { ctx.expect(true) } }],",
        '  expect: async (ctx) => {',
        '    ctx.assert(true)',
        '  },',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'evaluate'],
      })

      expect(nativeFactCount(record, 'eval')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )
})

function nativeFactCount(
  record: { readonly nativeFacts?: readonly { readonly replaces?: readonly { readonly extractor: string }[] }[] },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) => fact.replaces?.some((item) => item.extractor === extractor)).length
}
