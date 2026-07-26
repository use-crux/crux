/**
 * Type contract for the RFC #173 boundary-first output builders.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and `@ts-expect-error`
 * markers carry the contract for the descriptor/builder intersection, the
 * depth-four-known / string-fallback `path` overload, conditional `.items()` /
 * `.sentences()`, and the hold-capability marker.
 */

import { expectTypeOf } from 'vitest'
import type { BoundaryDef } from '../src/safety'
import {
  outputText,
  outputObject,
  type HoldMarker,
  type ItemsBoundary,
  type PathBoundary,
  type StringPathSentencesBoundary,
} from '../src/safety/output/output-boundaries'

interface Order {
  account: {
    email: string
    profile: {
      name: string
      address: { city: string; geo: { lat: number } }
    }
  }
  items: readonly { sku: string; qty: number }[]
  tags: readonly string[]
  summary: string
  score: number
}

// --- Every fluent result is still a frozen BoundaryDef ---
expectTypeOf(outputText()).toMatchTypeOf<BoundaryDef<'model.output.text', string>>()
expectTypeOf(outputObject<Order>()).toMatchTypeOf<BoundaryDef<'model.output.object', Order>>()
expectTypeOf(outputObject<Order>().path('account.email')).toMatchTypeOf<
  BoundaryDef<'model.output.object', string>
>()

// --- Text refinements and hold capability ---
expectTypeOf(outputText()).toMatchTypeOf<HoldMarker<'permitted'>>()
expectTypeOf(outputText().deltas()).toMatchTypeOf<HoldMarker<'permitted'>>()
expectTypeOf(outputText().sentences()).toMatchTypeOf<HoldMarker<'permitted'>>()
expectTypeOf(outputText().lines()).toMatchTypeOf<HoldMarker<'permitted'>>()
expectTypeOf(outputText().complete()).toMatchTypeOf<HoldMarker<'excluded'>>()
outputText().segments({ maxCharacters: 80, next: (b) => (b.length >= 80 ? 80 : undefined) })

// A refined text unit exposes no further refinement methods.
// @ts-expect-error - deltas is terminal; no re-refinement.
outputText().deltas().complete()
// @ts-expect-error - segments requires a maxCharacters + next config.
outputText().segments({})

// --- Object path inference through depth four ---
expectTypeOf(outputObject<Order>().path('account.email')).toEqualTypeOf<PathBoundary<string>>()
expectTypeOf(outputObject<Order>().path('account.profile.address.city')).toEqualTypeOf<
  PathBoundary<string>
>()
// Root object and scalar paths exclude hold.
expectTypeOf(outputObject<Order>()).toMatchTypeOf<HoldMarker<'excluded'>>()
expectTypeOf(outputObject<Order>().path('score')).toMatchTypeOf<HoldMarker<'excluded'>>()

// The string-fallback overload accepts a dynamic/typo path without erroring; its
// subject is `unknown` (autocomplete suggests known paths but does not restrict).
expectTypeOf(outputObject<Order>().path('account.missing')).toEqualTypeOf<PathBoundary<unknown>>()

// Deeper-than-cap runtime strings stay valid with an `unknown` subject (no never, no TS2589).
expectTypeOf(outputObject<Order>().path('account.profile.address.geo.lat.deeper')).toEqualTypeOf<
  PathBoundary<unknown>
>()

// --- Array paths expose items(); string paths expose sentences() ---
expectTypeOf(outputObject<Order>().path('items').items()).toEqualTypeOf<
  ItemsBoundary<{ sku: string; qty: number }>
>()
expectTypeOf(outputObject<Order>().path('summary').sentences()).toEqualTypeOf<StringPathSentencesBoundary>()
// Item units and string-path sentence units differ in hold capability.
expectTypeOf(outputObject<Order>().path('items').items()).toMatchTypeOf<HoldMarker<'excluded'>>()
expectTypeOf(outputObject<Order>().path('summary').sentences()).toMatchTypeOf<HoldMarker<'permitted'>>()

// @ts-expect-error - a scalar (number) path has neither items() nor sentences().
outputObject<Order>().path('score').items()
// @ts-expect-error - an array path is not a string path.
outputObject<Order>().path('items').sentences()
// @ts-expect-error - a string path is not an array path.
outputObject<Order>().path('summary').items()
