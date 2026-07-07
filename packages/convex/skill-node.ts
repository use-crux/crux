/**
 * Convex runtime profile for `@use-crux/core/skill/node`.
 *
 * This explicit Node-only subpath mirrors core's local file loader for projects
 * that use Convex alongside Node-side skill authoring/build steps.
 *
 * @module
 */

export { fileSkill, skill } from '@use-crux/core/skill/node'
export {
  createAgentSkillKit,
  createSkillActivationSession,
  inlineSkill,
  registry,
  resolveRegistrySkill,
  skillsSh,
  SkillLoadError,
} from '@use-crux/core/skill/node'

export { convexSkillActivationPersistence } from './agent/skill-activation-persistence'
export type { ConvexSkillActivationTarget } from './agent/skill-activation-persistence'

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
  SkillActivationSnapshot,
  SkillActivationTarget,
  SkillMeta,
  SkillReference,
  SkillReferenceResult,
  SkillToolDef,
} from '@use-crux/core/skill/node'
