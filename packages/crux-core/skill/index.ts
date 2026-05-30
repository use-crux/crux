/**
 * @crux/core/skill — Markdown-based skill loading for Crux agents.
 *
 * Skills are reusable instruction sets that an LLM can load on-demand.
 * Compatible with the skills.sh community format (SKILL.md with YAML frontmatter).
 *
 * @example
 * ```ts
 * import { skill } from '@crux/core/skill'
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

// Lazy-loaded file module — only resolved when skill.fromFile() is called.
// This prevents esbuild/Convex from pulling in fs/path at bundle time.
let _fileModule: { fileSkill: (path: string) => Skill } | null = null
function _loadFileModule() {
  if (!_fileModule) {
    try {
      // Use a variable to prevent static analysis by bundlers
      const modPath = './file-loader'
      _fileModule = require(modPath) as typeof _fileModule
    } catch {
      throw new Error(
        'skill.fromFile() requires Node.js. In serverless environments (Convex, edge), ' +
          'use skill.fromRegistry() or skill.inline() instead.',
      )
    }
  }
  return _fileModule!
}

export { inlineSkill } from './loaders'
export { parseFrontmatter } from './frontmatter'
export type { ParsedSkillFile } from './frontmatter'
export { generateCatalog } from './catalog'
export { registry, registerRegistry, resolveRegistrySkill } from './registry'
export type { RegistryConfig, Registry } from './registry'
export { clearCache, cacheSize, DEFAULT_CACHE_TTL } from './cache'
export {
  registerSkillState,
  getSkillState,
  unregisterSkillState,
  getLatestSkillState,
  getNewlyActivatedSkills,
  markSkillsInjected,
  clearInjectedSkills,
} from './state'
export {
  LOAD_SKILL_TOOL_NAME,
  LOAD_REFERENCE_TOOL_NAME,
  createSkillState,
  createLoadSkillTool,
  createLoadReferenceTool,
} from './tools'
export type { Skill, SkillMeta, SkillReference, InlineSkillConfig, LazySkill } from './types'
export { SkillLoadError } from './types'
export type { SkillActivationState } from './tools'
export { createAgentSkillKit } from './agent-kit'
export type { AgentSkillKit, SkillPersistence, SkillToolDef } from './agent-kit'

/**
 * The skill namespace — entry point for creating skills.
 *
 * `fromFile` lazy-loads the Node.js-dependent file-loader module on first call.
 * This avoids pulling `fs`/`path` into serverless bundles (Convex, edge runtimes)
 * that only use `inline` or `fromRegistry`.
 */
export const skill = Object.freeze({
  /**
   * Create a skill from inline text.
   * Requires id and description — otherwise just use context().
   */
  inline: inlineSkill,
  /**
   * Load a skill from a local SKILL.md file.
   * Reads synchronously at call time. Parses YAML frontmatter.
   * Only available in Node.js environments (uses fs/path).
   *
   * Import `@crux/core/skill/file-loader` directly if your bundler
   * chokes on the lazy require (e.g., Convex without 'use node').
   */
  fromFile(filePath: string): Skill {
    // Lazy require at call time — not at import time.
    // esbuild/Convex won't resolve this because require() on a string
    // literal in a function body is not statically analyzable.
    const mod = _loadFileModule()
    return mod.fileSkill(filePath)
  },
  /**
   * Load a skill from a registry.
   * Content is fetched lazily on first prompt.resolve(), then cached.
   * All identifiers must be prefixed: 'skills.sh:owner/repo/skill' or 'myregistry:skill'.
   */
  fromRegistry: registrySkill,
})
