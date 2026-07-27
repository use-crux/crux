/** Public inference contract for semantic model-ingress boundaries. */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  guardrail,
  type BoundaryIdOf,
  type MediaInputSource,
  type ModelInputOrigin,
  type SafetyTargetId,
  type TextInputSource,
} from '../src/safety'

guardrail({
  id: 'guard-all-input-text',
  on: boundary.input.text(),
  run: (_subject, context) => {
    expectTypeOf(context.boundary.id).toEqualTypeOf<'model.input.text'>()
    expectTypeOf(context.origin).toEqualTypeOf<
      Extract<ModelInputOrigin, { readonly source: TextInputSource }>
    >()
    return { action: 'allow' }
  },
})

guardrail({
  id: 'guard-user-and-retrieval-text',
  on: boundary.input.text({
    from: ['retrieval', 'user', 'retrieval'] as const,
  }),
  run: (_subject, context) => {
    expectTypeOf(context.origin.source).toEqualTypeOf<'user' | 'retrieval'>()
    return { action: 'allow' }
  },
})

const selectedTextSources: readonly TextInputSource[] = ['tool', 'retrieval']
boundary.input.text({ from: selectedTextSources })

boundary.input.text({ from: 'memory' })

// @ts-expect-error - an explicitly empty selector can never match a contribution.
boundary.input.text({ from: [] as const })

// @ts-expect-error - retrieval contributes text, never canonical media.
boundary.input.media({ from: 'retrieval' })

const instructionsBoundary = boundary.input.instructions()
expectTypeOf(instructionsBoundary.id).toEqualTypeOf<'model.instructions'>()

const selectedTextBoundaries = [
  boundary.input.text({ from: 'tool' }),
  boundary.input.text({ from: 'retrieval' }),
] as const
expectTypeOf<BoundaryIdOf<typeof selectedTextBoundaries>>().toEqualTypeOf<'model.input.text'>()

guardrail({
  id: 'guard-selected-text-boundaries',
  on: selectedTextBoundaries,
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(context.origin.source).toEqualTypeOf<'tool' | 'retrieval'>()
    return { action: 'allow' }
  },
})

guardrail({
  id: 'invalid-instruction-strip',
  on: boundary.input.instructions(),
  // @ts-expect-error - strip is a media-only action.
  run: () => ({ action: 'strip', reason: 'Not a text action.' }),
})

type LegacyInputId = Extract<SafetyTargetId, 'user.input' | 'model.input'>
// @ts-expect-error - legacy input IDs are not part of the canonical vocabulary.
const legacyInputId: LegacyInputId = 'user.input'
void legacyInputId

// @ts-expect-error - removed in favor of semantic model-ingress helpers.
boundary.input.user()
// @ts-expect-error - renamed to boundary.input.instructions().
boundary.input.model()
// @ts-expect-error - raw tool policies are authored with toolPolicy().
boundary.tool.call()
// @ts-expect-error - raw tool policies are authored with toolPolicy().
boundary.tool.result()
// @ts-expect-error - approval is governed by toolPolicy().
boundary.approval.request()
// @ts-expect-error - guard rendered retrieval through boundary.input.text().
boundary.retrieval.result()

guardrail({
  id: 'guard-all-input-media',
  on: boundary.input.media(),
  run: (_subject, context) => {
    expectTypeOf(context.boundary.id).toEqualTypeOf<'model.input.media'>()
    expectTypeOf(context.origin).toEqualTypeOf<Extract<ModelInputOrigin, { readonly source: MediaInputSource }>>()
    return { action: 'allow' }
  },
})

guardrail({
  id: 'guard-tool-text',
  on: boundary.input.text({ from: 'tool' }),
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(context.origin).toEqualTypeOf<{
      readonly source: 'tool'
      readonly kind: 'tool-result'
      readonly toolName: string
      readonly toolCallId?: string
      readonly partIndex?: number
    }>()
    return { action: 'allow' }
  },
})
