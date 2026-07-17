/** Public type contract for the composite media guardrail strategy. */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  guardrail,
  type MediaGuardrailAction,
  type MediaGuardrailOptions,
  type MediaSizeGuardrailRule,
  type MediaSourceGuardrailRule,
  type MediaTypeGuardrailRule,
  type MediaTypePattern,
} from '../src/safety'

const patterns = ['image/png', 'image/*'] as const satisfies readonly [MediaTypePattern, ...MediaTypePattern[]]
const mediaTypes = {
  allow: patterns,
} satisfies MediaTypeGuardrailRule
const options = {
  mediaTypes,
  action: 'strip',
} satisfies MediaGuardrailOptions
const run = guardrail.media(options)

guardrail({
  id: 'typed-media-policy',
  on: boundary.input.media(),
  run,
})

// @ts-expect-error - at least one media policy rule is required.
guardrail.media({})

guardrail.media({
  // @ts-expect-error - MIME patterns require a slash.
  mediaTypes: { allow: ['image-png'] },
})

guardrail.media({
  // @ts-expect-error - a MIME allowlist must contain at least one pattern.
  mediaTypes: { allow: [] },
})

const size = {
  maxBytes: 1024,
} satisfies MediaSizeGuardrailRule
const sources = {
  allowHosts: ['cdn.example.com'],
} satisfies MediaSourceGuardrailRule

guardrail.media({ size })
guardrail.media({ sources })
guardrail.media({ mediaTypes, size })
guardrail.media({ mediaTypes, size, sources })

guardrail({
  id: 'invalid-text-media-policy',
  // @ts-expect-error - the media strategy can target only input media.
  on: boundary.input.text(),
  run,
})

guardrail({
  id: 'invalid-output-media-policy',
  // @ts-expect-error - the media strategy cannot target output text.
  on: boundary.output.text(),
  run,
})

expectTypeOf(options.action).toEqualTypeOf<'strip'>()
expectTypeOf<MediaGuardrailAction>().toEqualTypeOf<'block' | 'strip'>()
