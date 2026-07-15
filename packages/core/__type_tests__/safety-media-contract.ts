/** Public inference contract for input media guardrails. */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  constraint,
  guardrail,
  type MediaGuardrailRunResult,
  type MediaPartSubject,
} from '../src/safety'

constraint({
  id: 'invalid-input-media-constraint',
  // @ts-expect-error - input media is a guardrail-only boundary.
  on: boundary.input.media(),
  run: () => ({ pass: true }),
})

constraint({
  id: 'valid-output-text-constraint',
  on: boundary.output.text(),
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(context.boundary.id).toEqualTypeOf<'model.output.text'>()
    return { pass: true }
  },
})

const mediaPolicy = guardrail({
  id: 'inspect-input-media',
  on: boundary.input.media(),
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<MediaPartSubject>()
    expectTypeOf(context.boundary.id).toEqualTypeOf<'user.input.media'>()
    return { action: 'allow' }
  },
})

expectTypeOf(mediaPolicy.run).returns.toMatchTypeOf<
  MediaGuardrailRunResult | Promise<MediaGuardrailRunResult>
>()

guardrail({
  id: 'narrow-input-media',
  on: boundary.input.media(),
  run: (subject) => {
    if (subject.part.type === 'file') {
      expectTypeOf(subject.part.filename).toEqualTypeOf<string | undefined>()
    }
    if (subject.part.type === 'image') {
      // @ts-expect-error - image parts do not expose file-only names.
      subject.part.filename
    }
    return { action: 'allow' }
  },
})

guardrail({
  id: 'invalid-media-rewrite',
  on: boundary.input.media(),
  run: () => ({
    // @ts-expect-error - media guardrails cannot rewrite canonical parts.
    action: 'rewrite',
    value: 'replacement',
    rewrite: { kind: 'normalize' },
  }),
})

guardrail({
  id: 'invalid-media-hold',
  on: boundary.input.media(),
  run: () => ({
    // @ts-expect-error - media guardrails cannot hold stream segments.
    action: 'hold',
  }),
})

guardrail({
  id: 'invalid-media-strip-without-reason',
  on: boundary.input.media(),
  // @ts-expect-error - strip results require a reason.
  run: () => ({ action: 'strip' }),
})

guardrail({
  id: 'invalid-media-stream',
  on: boundary.input.media(),
  // @ts-expect-error - media guardrails do not support stream configuration.
  stream: 'sentence',
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-media-input-text-tuple',
  // @ts-expect-error - media guardrails cannot mix with text boundaries.
  on: [boundary.input.media(), boundary.input.text()] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'invalid-media-output-text-tuple',
  // @ts-expect-error - media guardrails cannot mix with output boundaries.
  on: [boundary.input.media(), boundary.output.text()] as const,
  run: () => ({ action: 'allow' }),
})

guardrail({
  id: 'valid-input-output-text-tuple',
  on: [boundary.input.text(), boundary.output.text()] as const,
  run: (subject, context) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(context.boundary.id).toEqualTypeOf<'user.input' | 'model.output.text'>()
    return { action: 'allow' }
  },
})
