/**
 * @use-crux/core/skill/node — Node.js skill loading helpers.
 *
 * Import this subpath when your app can use local filesystem APIs and wants to
 * load SKILL.md files from disk. Edge and serverless bundles should import the
 * universal `@use-crux/core/skill` entry instead.
 *
 * @example
 * ```ts
 * import { skill } from '@use-crux/core/skill/node'
 *
 * const seo = skill.fromFile('./skills/seo-analysis/SKILL.md')
 * ```
 */

import { inlineSkill } from './loaders'
import { fileSkill } from './file-loader'
import { registrySkill } from './registry'

export { fileSkill } from './file-loader'
export {
  clearCache,
  cacheSize,
  DEFAULT_CACHE_TTL,
  createAgentSkillKit,
  createSkillActivationSession,
  generateIndex,
  inlineSkill,
  parseFrontmatter,
  registry,
  resolveRegistrySkill,
  skillsSh,
  SkillLoadError,
} from './index'
export type {
  AgentSkillKit,
  AgentSkillKitOptions,
  InlineSkillConfig,
  LazySkill,
  ParsedSkillFile,
  Registry,
  RegistryConfig,
  Skill,
  SkillActivationPersistence,
  SkillActivationResult,
  SkillActivationSession,
  SkillActivationSessionForTargetOptions,
  SkillActivationSessionOptions,
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillMeta,
  SkillReference,
  SkillReferenceResult,
  SkillToolDef,
} from './index'

/**
 * Node-capable skill namespace.
 *
 * It includes the universal loaders plus `fromFile`, which synchronously reads
 * a local SKILL.md file and its sibling `references/*.md` files.
 */
export const skill = Object.freeze({
  /**
   * Create a skill from inline text.
   * Requires id and description — otherwise just use context().
   */
  inline: inlineSkill,
  /**
   * Load a skill from a local SKILL.md file.
   *
   * Reads synchronously at call time, parses YAML frontmatter, and discovers
   * Markdown reference files in a sibling `references/` directory.
   */
  fromFile: fileSkill,
  /**
   * Load a skill from a registry.
   *
   * Content is fetched lazily on first prompt resolution, then cached.
   */
  fromRegistry: registrySkill,
})
