import { flowDefinitionRef } from '@use-crux/core/observability'
import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from './native-first-party-fixture-helpers'

/**
 * Runtime→index identity for `flow()` durable targets.
 *
 * The runtime emitter `flowDefinitionRef(name)` (in
 * `packages/core/src/flow/scope.ts`) always keys the ref to the resolved
 * `flow(name, …)` string. The static extractor reads that name only when it is a
 * direct string literal; a non-literal name is an unsupported durable-target
 * authoring form that the extractor marks `runtimeTarget.nameLiteral === false`
 * and the `runtime.non_literal_target_name` lint (crates/lints/src/rules/runtime.rs)
 * reports.
 *
 * The single-file fixture harness only populates the native Rust/Oxc static
 * frontend (the TypeScript bundled extractor needs a resolved project/import
 * graph and emits nothing here), so these fixtures assert the native canonical
 * id directly rather than describing an empty TypeScript fallback as agreement.
 */
describe('flow runtime-ref identity', () => {
  const flowDefinitions = (out: {
    definitions: readonly { id: string; kind: string; metadata?: unknown }[]
  }) => out.definitions.filter((definition) => definition.kind === 'flow')

  const nameLiteralOf = (definition: { metadata?: unknown }): unknown =>
    (definition.metadata as { runtimeTarget?: { nameLiteral?: unknown } } | undefined)?.runtimeTarget
      ?.nameLiteral

  itWithRustOxc(
    'keys a literal-named flow to the exact runtime flowDefinitionRef id',
    async () => {
      // Hostile authored name to exercise safe_id normalization on the shared path.
      const source = [
        "export const researchFlow = flow('Research Flow!', async (scope) => {",
        "  await scope.step('plan', async () => 1)",
        '})',
      ].join('\n')
      const { nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['flow'],
      })

      expect(nativeFactCount(record, 'flow')).toBe(1)
      const [flowDefinition] = flowDefinitions(nativeOut)
      // The static definition id is byte-identical to the runtime helper's id, so
      // a `flow.run` span joins the Project Index for the supported literal path.
      expect(flowDefinition?.id).toBe(flowDefinitionRef('Research Flow!').id)
      expect(flowDefinition?.id).toBe('flow:Research-Flow')
      expect(nameLiteralOf(flowDefinition!)).toBe(true)
    },
    30_000,
  )

  itWithRustOxc(
    'marks a non-literal flow name as a lint-flagged fallback that cannot join the runtime ref',
    async () => {
      // A non-literal durable-target name: the extractor cannot resolve the
      // runtime string, so it falls back to the source-derived local name and
      // marks the target non-literal for `runtime.non_literal_target_name`.
      const source = [
        'const resolveName = () => `research-${Math.random()}`',
        'export const dynamicFlow = flow(resolveName(), async (scope) => {',
        "  await scope.step('plan', async () => 1)",
        '})',
      ].join('\n')
      const { nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['flow'],
      })

      expect(nativeFactCount(record, 'flow')).toBe(1)
      const [flowDefinition] = flowDefinitions(nativeOut)
      // The fallback id is derived from the source local name, never a
      // runtime-resolvable value, so a `flow.run` span keyed by the resolved
      // name can never join it. The extractor flags this for the author.
      expect(nameLiteralOf(flowDefinition!)).toBe(false)
      expect(flowDefinition?.id).toContain('dynamicFlow')
      expect(flowDefinition?.id).not.toBe(flowDefinitionRef('research-0.5').id)
    },
    30_000,
  )
})

/** Counts native fact packets that replace one bundled first-party extractor. */
function nativeFactCount(
  record: {
    readonly nativeFacts?: readonly { readonly replaces?: readonly { readonly extractor: string }[] }[]
  },
  extractor: string,
): number {
  return (record.nativeFacts ?? []).filter((fact) =>
    fact.replaces?.some((item) => item.extractor === extractor),
  ).length
}
