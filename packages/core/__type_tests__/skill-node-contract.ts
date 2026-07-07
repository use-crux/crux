/**
 * Compile-time contract for the split skill loader surface.
 *
 * The universal `@use-crux/core/skill` entry stays safe for edge/serverless
 * bundles. Local file loading is Node-only and lives behind
 * `@use-crux/core/skill/node`.
 */

import { expectTypeOf } from 'vitest'
import { skill as universalSkill, type Skill } from '@use-crux/core/skill'
import { fileSkill, skill as nodeSkill } from '@use-crux/core/skill/node'

const inline = universalSkill.inline({
  id: 'tone',
  description: 'Tone guidance',
  instructions: 'Use a direct tone.',
})

expectTypeOf(inline).toEqualTypeOf<Skill>()
expectTypeOf(universalSkill.fromRegistry).toEqualTypeOf<typeof nodeSkill.fromRegistry>()

// @ts-expect-error local file loading is not available from the universal entry.
universalSkill.fromFile('./skills/tone/SKILL.md')

expectTypeOf(fileSkill).parameter(0).toEqualTypeOf<string>()
expectTypeOf(fileSkill).returns.toEqualTypeOf<Skill>()
expectTypeOf(nodeSkill.fromFile).toEqualTypeOf<typeof fileSkill>()
