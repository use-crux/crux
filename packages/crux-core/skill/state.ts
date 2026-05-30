/**
 * Module-level skill activation state registry.
 *
 * Bridges the gap between LoadSkill tool execute functions and middleware/contextHandlers
 * that need to detect newly activated skills for re-resolution.
 *
 * Each SkillActivationState is registered here when created (during prompt resolution).
 * The middleware or contextHandler can then look up the state to detect changes.
 */

import type { SkillActivationState } from './tools'

/**
 * Map of state ID -> SkillActivationState.
 * States are registered during prompt resolution and cleaned up after execution.
 */
const stateRegistry = new Map<string, SkillActivationState>()

let stateCounter = 0

/** Register a skill activation state and return a unique ID for it. */
export function registerSkillState(state: SkillActivationState): string {
  const id = `skill-state-${++stateCounter}`
  stateRegistry.set(id, state)
  return id
}

/** Get a registered skill activation state by ID. */
export function getSkillState(id: string): SkillActivationState | undefined {
  return stateRegistry.get(id)
}

/** Remove a registered skill activation state. */
export function unregisterSkillState(id: string): void {
  stateRegistry.delete(id)
}

/**
 * Get the most recently registered skill state.
 * Used by middleware that doesn't have direct access to the state ID.
 */
export function getLatestSkillState(): SkillActivationState | undefined {
  if (stateRegistry.size === 0) return undefined
  const entries = [...stateRegistry.entries()]
  return entries[entries.length - 1]![1]
}

/** Track which skills were injected in the previous step (to detect new activations). */
const injectedSkills = new Set<string>()

/** Check if there are newly activated skills that haven't been injected yet. */
export function getNewlyActivatedSkills(state: SkillActivationState): string[] {
  const newSkills: string[] = []
  for (const id of state.active) {
    if (!injectedSkills.has(id)) {
      newSkills.push(id)
    }
  }
  return newSkills
}

/** Mark skills as injected after re-resolution. */
export function markSkillsInjected(skillIds: string[]): void {
  for (const id of skillIds) {
    injectedSkills.add(id)
  }
}

/** Clear injected skills tracking (call between separate agent executions). */
export function clearInjectedSkills(): void {
  injectedSkills.clear()
}
