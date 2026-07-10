/**
 * @use-crux/core/skill — Markdown-based skill loading for Crux agents.
 *
 * Skills are reusable instruction sets that an LLM can load on-demand.
 * Compatible with the skills.sh community format (SKILL.md with YAML frontmatter).
 *
 * This universal entry point avoids Node.js built-ins. Import
 * `@use-crux/core/skill/node` when you need to load local SKILL.md files.
 *
 * @example
 * ```ts
 * import { skill } from '@use-crux/core/skill'
 *
 * const tone = skill.inline({
 *   id: 'tone',
 *   description: 'Writing tone guidelines',
 *   instructions: 'Always write in a warm professional tone.',
 * })
 *
 * const agent = agent({
 *   prompt: prompt({ use: [tone] }),
 * })
 * ```
 */

import type { Skill } from './types'
import { inlineSkill } from './loaders'
import { registrySkill, registry } from './registry'

export { inlineSkill } from './loaders'
export { parseFrontmatter } from './frontmatter'
export type { ParsedSkillFile } from './frontmatter'
export { generateIndex } from './project-index'
export { registry, resolveRegistrySkill, skillsSh } from './registry'
export type { RegistryConfig, Registry } from './registry'
export { clearCache, cacheSize, DEFAULT_CACHE_TTL } from './cache'
export type { Skill, SkillMeta, SkillReference, InlineSkillConfig, LazySkill } from './types'
export { SkillLoadError } from './types'
export { createAgentSkillKit } from './agent-kit'
export type { AgentSkillKit, AgentSkillKitOptions, SkillToolDef } from './agent-kit'
export { createSkillActivationSession } from './session'
export type {
  SkillActivationPersistence,
  SkillActivationResult,
  SkillActivationSession,
  SkillActivationSessionForTargetOptions,
  SkillActivationSessionOptions,
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillReferenceResult,
} from './session'

/**
 * The skill namespace — entry point for creating skills.
 *
 * This namespace is safe for edge and serverless bundles because it does not
 * import Node.js built-ins. Use `@use-crux/core/skill/node` for local files.
 */
export const skill = Object.freeze({
  /**
   * Create a skill from inline text.
   * Requires id and description — otherwise just use context().
   */
  inline: inlineSkill,
  /**
   * Load a skill from a registry.
   * Content is fetched lazily on first prompt.resolve(), then cached.
   *
   * Pass a registry value explicitly. Use the exported `skillsSh` value for
   * bundled skills.sh skills and `registry(...)` for custom registries.
   */
  fromRegistry: registrySkill,
})
