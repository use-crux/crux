/** Public inference contract for additional Safety lifecycle boundaries. */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  constraint,
  guardrail,
  type BoundaryDef,
  type MemoryWriteGuardrailResult,
  type ModelInputOrigin,
  type TextInputSource,
  type ToolDefinitionGuardrailResult,
  type ToolDefinitionOrigin,
  type ToolDefinitionSubject,
  type ToolDefinitionSource,
  type ToolDescriptionOrigin,
} from '../src/safety'

const additionalTextSources: readonly TextInputSource[] = [
  'memory',
  'handoff',
  'feedback',
]
boundary.input.text({ from: additionalTextSources })

guardrail({
  id: 'guard-memory-ingress',
  on: boundary.input.text({ from: 'memory' }),
  run: (_text, context) => {
    expectTypeOf(context.origin).toEqualTypeOf<
      Extract<ModelInputOrigin, { readonly source: 'memory' }>
    >()
    return { action: 'allow' }
  },
})

guardrail({
  id: 'guard-handoff-and-feedback-ingress',
  on: boundary.input.text({ from: ['handoff', 'feedback'] as const }),
  run: (_text, context) => {
    expectTypeOf(context.origin).toEqualTypeOf<
      Extract<
        ModelInputOrigin,
        { readonly source: 'handoff' | 'feedback' }
      >
    >()
    return { action: 'allow' }
  },
})

guardrail({
  id: 'guard-authored-tool-definitions',
  on: boundary.input.tools({ from: 'authored' }),
  run: (subject, context): ToolDefinitionGuardrailResult => {
    expectTypeOf(subject).toEqualTypeOf<ToolDefinitionSubject>()
    expectTypeOf(context.origin).toEqualTypeOf<
      Extract<ToolDefinitionOrigin, { readonly kind: 'authored' }>
    >()
    return { action: 'strip', reason: 'This tool must not be exposed.' }
  },
})

const selectedToolSources: readonly ToolDefinitionSource[] = [
  'authored',
  'discovered',
]
boundary.input.tools({ from: selectedToolSources })

// @ts-expect-error - an explicitly empty tool source selector can never match.
boundary.input.tools({ from: [] as const })

// @ts-expect-error - text origins are not tool-definition provenance.
boundary.input.tools({ from: 'memory' })

guardrail({
  id: 'invalid-root-tool-rewrite',
  on: boundary.input.tools(),
  run: () => ({
    // @ts-expect-error - root tool definitions cannot be rewritten.
    action: 'rewrite',
    value: {},
    rewrite: { kind: 'normalize' },
  }),
})

constraint({
  id: 'invalid-input-text-constraint',
  // @ts-expect-error - constraints target output-quality boundaries only.
  on: boundary.input.text(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'invalid-instructions-constraint',
  // @ts-expect-error - constraints target output-quality boundaries only.
  on: boundary.input.instructions(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'invalid-tool-definition-constraint',
  // @ts-expect-error - tool definitions use guardrails, never constraints.
  on: boundary.input.tools(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'invalid-tool-description-constraint',
  // @ts-expect-error - tool descriptions use guardrails, never constraints.
  on: boundary.input.tools().descriptions(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'invalid-memory-write-constraint',
  // @ts-expect-error - memory writes use guardrails, never constraints.
  on: boundary.memory.write(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'invalid-validation-feedback-constraint',
  // @ts-expect-error - feedback ingress uses guardrails, never constraints.
  on: boundary.validation.feedback(),
  run: () => ({ pass: true }),
})

declare const toolCallBoundary: BoundaryDef<'tool.call'>
declare const toolResultBoundary: BoundaryDef<'tool.result'>
declare const approvalRequestBoundary: BoundaryDef<'approval.request'>

for (const on of [
  toolCallBoundary,
  toolResultBoundary,
  approvalRequestBoundary,
] as const) {
  constraint({
    id: 'invalid-action-constraint',
    // @ts-expect-error - action lifecycle boundaries do not run output constraints.
    on,
    run: () => ({ pass: true }),
  })
}

interface MemoryRecord {
  readonly summary: string
  readonly keep: boolean
}

guardrail({
  id: 'guard-memory-writes',
  on: boundary.memory.write<MemoryRecord>(),
  run: (candidate): MemoryWriteGuardrailResult<MemoryRecord> => {
    expectTypeOf(candidate).toEqualTypeOf<MemoryRecord>()
    return candidate.keep
      ? {
          action: 'rewrite',
          value: { ...candidate, summary: candidate.summary.trim() },
          rewrite: { kind: 'normalize' },
        }
      : { action: 'drop', reason: 'This candidate should not be persisted.' }
  },
})

guardrail({
  id: 'invalid-memory-hold',
  on: boundary.memory.write(),
  run: () => ({
    // @ts-expect-error - memory-write candidates are closed commit units.
    action: 'hold',
  }),
})

guardrail({
  id: 'rewrite-discovered-tool-descriptions',
  on: boundary.input.tools({ from: 'discovered' }).descriptions(),
  run: (description, context) => {
    expectTypeOf(description).toEqualTypeOf<string>()
    expectTypeOf(context.origin).toEqualTypeOf<
      Extract<ToolDescriptionOrigin, { readonly kind: 'discovered' }>
    >()
    return {
      action: 'rewrite',
      value: description.trim(),
      rewrite: { kind: 'normalize' },
    }
  },
})

guardrail({
  id: 'rewrite-tool-and-model-descriptions',
  on: [
    boundary.input.tools().descriptions(),
    boundary.input.text(),
    boundary.input.instructions(),
    boundary.output.text().complete(),
    boundary.validation.feedback(),
  ] as const,
  run: (description) => {
    expectTypeOf(description).toEqualTypeOf<string>()
    return {
      action: 'rewrite',
      value: description.trim(),
      rewrite: { kind: 'normalize' },
    }
  },
})

guardrail({
  id: 'invalid-tool-description-strip',
  on: boundary.input.tools().descriptions(),
  run: () => ({
    // @ts-expect-error - tool descriptions use the closed text result family.
    action: 'strip',
    reason: 'Description strings are rewritable, not strippable.',
  }),
})

guardrail({
  id: 'invalid-root-tool-text-family',
  // @ts-expect-error - root tool definitions may mix only with root tool definitions.
  on: [boundary.input.tools(), boundary.input.text()] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-root-tool-description-family',
  // @ts-expect-error - root and description selectors are distinct result families.
  on: [boundary.input.tools(), boundary.input.tools().descriptions()] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-tool-description-object-family',
  // @ts-expect-error - tool descriptions mix only with closed string boundaries.
  on: [
    boundary.input.tools().descriptions(),
    boundary.output.object<{ readonly answer: string }>(),
  ] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-memory-text-family',
  // @ts-expect-error - memory writes may mix only with memory-write boundaries.
  on: [boundary.memory.write(), boundary.output.text()] as const,
  run: () => ({ action: 'allow' }),
})
