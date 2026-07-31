/**
 * Public contracts for skill activation sessions.
 *
 * These types are split from the runtime implementation so the session
 * module stays focused on behavior while callers still import everything
 * from `@use-crux/core/skill`.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyToolSet } from '../types'
import type { Context } from '../prompt/context-types'
import type { Skill } from './types'

/** Internal availability selector used by request representation planning. @internal */
export const skillAvailabilitySelection: unique symbol = Symbol('crux.skill.availabilitySelection')

/**
 * Serializable skill activation state.
 *
 * Use snapshots at process or framework boundaries, such as serverless agent
 * turns. When `injectedSkillIds` is omitted on session creation, the active
 * ids are treated as already injected because they are expected to be loaded
 * into the resolved prompt context.
 */
export interface SkillActivationSnapshot {
  /** Skill ids whose full instructions should be available to the session. */
  readonly activeSkillIds: readonly string[]
  /** Active skill ids whose instructions have already been injected into a model step. */
  readonly injectedSkillIds?: readonly string[]
}

/**
 * Persistence target for an external agent framework.
 *
 * The core session only needs a stable, string-keyed target. Adapters can
 * choose how to derive storage keys from fields such as `threadId`, `userId`,
 * or a framework-specific scope.
 */
export type SkillActivationTarget = Readonly<Record<string, string | undefined>>

/** Storage port for loading and saving skill activation snapshots. */
export interface SkillActivationPersistence<TTarget extends SkillActivationTarget = SkillActivationTarget> {
  /** Load the previously saved activation snapshot for `target`, if any. */
  load(target: TTarget): Promise<SkillActivationSnapshot | null>
  /** Save the current activation snapshot for `target`. */
  save(target: TTarget, snapshot: SkillActivationSnapshot): Promise<void>
}

/** Result returned by {@link SkillActivationSession.activate}. */
export type SkillActivationResult =
  | {
      readonly status: 'activated'
      readonly skill: Skill
      readonly message: string
    }
  | {
      readonly status: 'already-active'
      readonly skill: Skill
      readonly message: string
    }
  | {
      readonly status: 'not-found'
      readonly skillId: string
      readonly availableSkillIds: readonly string[]
      readonly message: string
    }

/** Result returned by {@link SkillActivationSession.reference}. */
export type SkillReferenceResult =
  | {
      readonly status: 'found'
      readonly skill: Skill
      readonly referenceName: string
      readonly content: string
    }
  | {
      readonly status: 'skill-not-found'
      readonly skillId: string
      readonly message: string
    }
  | {
      readonly status: 'reference-not-found'
      readonly skill: Skill
      readonly referenceName: string
      readonly availableReferenceNames: readonly string[]
      readonly message: string
    }

/** Options for {@link createSkillActivationSession}. */
export interface SkillActivationSessionOptions {
  /** Skills available for activation during this session. */
  readonly skills: readonly Skill[]
  /**
   * Initial activation snapshot.
   *
   * Passing ids from `SkillActivationSession.resolveInput()` should set only
   * `activeSkillIds`; those ids default to already-injected because prompt
   * resolution loads their instructions before the next model step.
   */
  readonly initial?: SkillActivationSnapshot | null
  /** Deterministic id override for tests or adapter-controlled sessions. */
  readonly id?: string
}

/** Options for `createSkillActivationSession.forTarget()`. */
export interface SkillActivationSessionForTargetOptions<
  TTarget extends SkillActivationTarget = SkillActivationTarget,
> extends Omit<SkillActivationSessionOptions, 'initial'> {
  /** Persistence lookup key. */
  readonly target: TTarget
  /** Storage port used to load the initial session snapshot. */
  readonly persistence: SkillActivationPersistence<TTarget>
}

/**
 * Per-turn skill activation boundary.
 *
 * The interface is intentionally small: callers activate a skill, load a
 * reference, ask for contexts/tools, and snapshot the result. The session
 * owns active ids, loader tools, injected ids, loaded contexts, and
 * persistence snapshots in one explicit boundary.
 */
export interface SkillActivationSession {
  /** Unique session id for private adapter registries and diagnostics. */
  readonly id: string
  /** Skills available in this session, keyed by skill id. */
  readonly available: ReadonlyMap<string, Skill>
  /** Restrict availability to skills retained by the selected request. @internal */
  [skillAvailabilitySelection](disabledSkillIds: readonly string[]): void

  /** Current active skill ids, in activation order. */
  activeIds(): readonly string[]
  /** Serializable snapshot for persistence or serverless turn continuity. */
  snapshot(): SkillActivationSnapshot
  /** Add this session's active skill ids to prompt resolve input. */
  resolveInput(baseInput?: Record<string, unknown>): Record<string, unknown>

  /** Activate a skill by id. */
  activate(skillId: string): SkillActivationResult
  /** Load supporting reference content from a known skill. */
  reference(skillId: string, referenceName: string): SkillReferenceResult

  /** Contexts containing the full instructions for every active known skill. */
  loadedContexts(): readonly Context<z.ZodType>[]
  /** Session-bound LoadSkill and LoadReference tools. */
  tools(): AnyToolSet
  /** Active skills whose instructions have not yet been injected into a model step. */
  newlyActivated(): readonly Skill[]
  /** Mark skill instructions as injected. Defaults to every active skill. */
  markInjected(skillIds?: readonly string[]): void
}

/** Apply a request-local availability selection to a skill session. @internal */
export function selectSkillAvailability(
  session: SkillActivationSession,
  disabledSkillIds: readonly string[],
): void {
  session[skillAvailabilitySelection](disabledSkillIds)
}
