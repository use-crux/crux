import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

describe('first-party Phase 7 flow native fixtures', () => {
  itWithRustOxc(
    'emits exact native flow facts from Rust/Oxc records',
    async () => {
      const source = [
        'const flowArgs = z.object({ topic: z.string(), limit: z.number().optional() })',
        '',
        'function enrichDraft() {',
        "  projectMemory.get('draft')",
        '  loadWorkspaceBrief()',
        '}',
        '',
        'function loadWorkspaceBrief() {',
        "  workspaceFiles.readFile('brief.md')",
        '}',
        '',
        'function publishDraft() {',
        "  sharedBoard.set('status', 'approved')",
        '}',
        '',
        'export const writerFlow = flow("writer", {',
        '  args: flowArgs,',
        '  handler: async ({ step, waitFor }) => {',
        "    await step('enrich draft', enrichDraft)",
        "    await waitFor('approval')",
        "    await step('publish draft', publishDraft)",
        '  },',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['flow'],
      })

      expect(nativeFactCount(record, 'flow')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native positional flow facts from Rust/Oxc records',
    async () => {
      const source = [
        "export const demoFlow = flow('demo', async (scope) => {",
        "  const plan = await scope.step('plan', async () => ({ steps: ['a', 'b'] }))",
        "  const search = await scope.step('search', async () => 42)",
        '  return { plan, search }',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['flow'],
      })

      expect(nativeFactCount(record, 'flow')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native shorthand receiver flow runtime facts from Rust/Oxc records',
    async () => {
      const source = [
        "export const reviewFlow = flow('review', async ({ ctx }) => {",
        "  await ctx.waitFor('approval')",
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['flow'],
      })

      expect(nativeFactCount(record, 'flow')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native durable task facts from Rust/Oxc records',
    async () => {
      const source = [
        "import { durableTask } from '@use-crux/core/runtime'",
        '',
        "export const embedDocument = durableTask('embed-document', {",
        '  run: async (input: { documentId: string }) => input.documentId,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['durableTask'],
      })

      expect(nativeFactCount(record, 'runtime.task')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'does not emit durable task facts for task lookalikes from other modules',
    async () => {
      const source = [
        "import { task as planTask } from '@use-crux/core/plan'",
        '',
        "export const launchPlan = planTask('Draft launch plan')",
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['durableTask'],
      })

      expect(nativeFactCount(record, 'runtime.task')).toBe(0)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )
})

/** Counts native fact packets that replace one bundled first-party extractor. */
function nativeFactCount(
  record: { readonly nativeFacts?: readonly { readonly replaces?: readonly { readonly extractor: string }[] }[] },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) => fact.replaces?.some((item) => item.extractor === extractor)).length
}
