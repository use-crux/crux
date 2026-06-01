/**
 * Convex runtime profile for `@crux/core/skill`.
 *
 * Skill authoring is currently identical to core Crux. Convex-specific skill
 * session persistence is owned by `convexAgent()`.
 *
 * @module
 */

export {
  clearInjectedSkills,
  createAgentSkillKit,
  createLoadReferenceTool,
  createLoadSkillTool,
  createSkillState,
  getLatestSkillState,
  getNewlyActivatedSkills,
  getSkillState,
  inlineSkill,
  markSkillsInjected,
  registerRegistry,
  registerSkillState,
  registry,
  resolveRegistrySkill,
  skill,
  SkillLoadError,
  unregisterSkillState,
} from '@crux/core/skill'

export type {
  AgentSkillKit,
  InlineSkillConfig,
  LazySkill,
  ParsedSkillFile,
  Skill,
  SkillActivationState,
  SkillMeta,
  SkillPersistence,
  SkillReference,
  SkillToolDef,
} from '@crux/core/skill'
