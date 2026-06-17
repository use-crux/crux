/**
 * Convex runtime profile for `@crux/core/skill`.
 *
 * Skill authoring is currently identical to core Crux. Convex-specific skill
 * session persistence is owned by `convexAgent()`.
 *
 * @module
 */

export {
  createAgentSkillKit,
  createSkillActivationSession,
  inlineSkill,
  registerRegistry,
  registry,
  resolveRegistrySkill,
  skill,
  SkillLoadError,
} from '@crux/core/skill'

export { convexSkillActivationPersistence } from './agent/skill-activation-persistence'
export type { ConvexSkillActivationTarget } from './agent/skill-activation-persistence'

export type {
  AgentSkillKit,
  AgentSkillKitOptions,
  InlineSkillConfig,
  LazySkill,
  ParsedSkillFile,
  Skill,
  SkillActivationPersistence,
  SkillActivationResult,
  SkillActivationSession,
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillMeta,
  SkillReferenceResult,
  SkillReference,
  SkillToolDef,
} from '@crux/core/skill'
