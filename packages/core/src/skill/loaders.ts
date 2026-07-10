/**
 * Skill loaders — create Skill objects from various sources.
 *
 * This file contains only the universal loaders (no Node.js dependencies).
 * The file-based loader (fileSkill) is in file-loader.ts to avoid pulling
 * in `fs`/`path` in serverless environments like Convex.
 */

import type { InlineSkillConfig, Skill, SkillReference } from './types'
import { SkillLoadError } from './types'

/**
 * Create a Skill from inline text.
 * Requires id and description — otherwise just use context().
 */
export function inlineSkill(config: InlineSkillConfig): Skill {
  if (!config.id) {
    throw new SkillLoadError('(unknown)', 'inline skill requires an id')
  }
  if (!config.description) {
    throw new SkillLoadError(config.id, 'inline skill requires a description')
  }
  if (!config.instructions) {
    throw new SkillLoadError(config.id, 'inline skill requires instructions')
  }

  const references: readonly SkillReference[] = config.references
    ? Object.freeze(Object.entries(config.references).map(([name, content]) => Object.freeze({ name, content })))
    : Object.freeze([])

  const meta = Object.freeze({
    name: config.id,
    description: config.description,
  })

  return Object.freeze({
    _tag: 'Skill' as const,
    id: config.id,
    description: config.description,
    instructions: config.instructions,
    references,
    meta,
    dump() {
      return config.instructions
    },
  })
}
