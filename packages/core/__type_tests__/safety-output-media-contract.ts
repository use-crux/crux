/** Public inference contract for output media guardrails. */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  constraint,
  guardrail,
  type BoundaryDef,
  type MediaPartOrigin,
  type MediaPartSubject,
  type Safety,
} from '../src/safety'

const outputMedia = boundary.output.media()

declare const publicSafety: Safety
// @ts-expect-error - adapter-only media projection is not part of the public session.
publicSafety.guardOutputMedia

expectTypeOf(outputMedia).toEqualTypeOf<BoundaryDef<'model.output.media', MediaPartSubject>>()

guardrail({
  id: 'inspect-output-origin',
  on: outputMedia,
  run: (subject) => {
    expectTypeOf(subject.origin).toEqualTypeOf<MediaPartOrigin>()
    inspectMediaNarrowing(subject)
    return { action: 'allow' }
  },
})

guardrail({
  id: 'portable-media',
  on: [boundary.input.media(), boundary.output.media()] as const,
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<MediaPartSubject>()
    expectTypeOf(context.boundary.id).toEqualTypeOf<'model.input.media' | 'model.output.media'>()
    return { action: 'strip', reason: 'Unsupported media.' }
  },
})

guardrail({
  id: 'invalid-output-media-text-tuple',
  // @ts-expect-error - media guardrails cannot mix with text boundaries.
  on: [boundary.output.media(), boundary.output.text()] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-output-media-rewrite',
  on: boundary.output.media(),
  run: () => ({
    // @ts-expect-error - media guardrails cannot rewrite canonical parts.
    action: 'rewrite',
    value: 'replacement',
    rewrite: { kind: 'normalize' },
  }),
})

function inspectMediaNarrowing(subject: MediaPartSubject): void {
  switch (subject.part.type) {
    case 'image':
    case 'audio':
    case 'video':
      expectTypeOf(subject.part.source).not.toBeAny()
      break
    case 'file':
      expectTypeOf(subject.part.filename).toEqualTypeOf<string | undefined>()
      break
  }

  const origin = subject.origin
  switch (origin.kind) {
    case 'message':
      expectTypeOf(origin.messageIndex).toEqualTypeOf<number>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<number>()
      return
    case 'step':
      expectTypeOf(origin.stepIndex).toEqualTypeOf<number>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<number>()
      return
    case 'tool-result':
      expectTypeOf(origin.toolName).toEqualTypeOf<string>()
      expectTypeOf(origin.toolCallId).toEqualTypeOf<string | undefined>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<number>()
      return
    case 'operation':
      break
  }

  switch (origin.operation) {
    case 'generateImage':
      if (origin.phase === 'output') {
        expectTypeOf(origin.field).toEqualTypeOf<'images'>()
        expectTypeOf(origin.partIndex).toEqualTypeOf<number>()
        return
      }
      if (origin.field === 'mask') {
        expectTypeOf(origin.partIndex).toEqualTypeOf<0>()
        return
      }
      expectTypeOf(origin.field).toEqualTypeOf<'images'>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<number>()
      return
    case 'generateSpeech':
      expectTypeOf(origin.phase).toEqualTypeOf<'output'>()
      expectTypeOf(origin.field).toEqualTypeOf<'audio'>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<0>()
      return
    case 'transcribe':
      expectTypeOf(origin.phase).toEqualTypeOf<'input'>()
      expectTypeOf(origin.field).toEqualTypeOf<'audio'>()
      expectTypeOf(origin.partIndex).toEqualTypeOf<0>()
  }
}

guardrail({
  id: 'invalid-output-media-hold',
  on: boundary.output.media(),
  run: () => ({
    // @ts-expect-error - media guardrails cannot hold stream segments.
    action: 'hold',
  }),
})

guardrail({
  id: 'invalid-output-media-stream',
  on: boundary.output.media(),
  // @ts-expect-error - media guardrails do not support stream configuration.
  stream: 'sentence',
  run: () => ({ action: 'allow' }),
})

constraint({
  id: 'invalid-output-media-constraint',
  // @ts-expect-error - output media is a guardrail-only boundary.
  on: boundary.output.media(),
  run: () => ({ pass: true }),
})

guardrail({
  id: 'output-media-strategy',
  on: boundary.output.media(),
  run: guardrail.media({
    mediaTypes: { allow: ['image/png'] },
    action: 'strip',
  }),
})
