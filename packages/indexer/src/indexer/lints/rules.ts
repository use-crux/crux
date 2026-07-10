import {
  IndexRuleDescriptorSchema,
  type IndexRuleDescriptor,
} from '@use-crux/core/project-index'
import descriptorFixture from '../../contracts/fixtures/rule-descriptors.json'

interface RuleDescriptorFixture {
  readonly descriptors: readonly IndexRuleDescriptor[]
}

const fixture = descriptorFixture as RuleDescriptorFixture
const descriptorValidationErrors = validateDescriptors(fixture.descriptors)
const descriptorIds = new Set(fixture.descriptors.map((descriptor) => descriptor.id))

/** Built-in lint rule ids emitted by the Rust lints crate descriptor fixture. */
export const indexLintRuleIds = [...descriptorIds].sort()

/** Built-in lint rule id. */
export type IndexLintRuleId = string

/**
 * Returns user-facing built-in rule descriptors generated from
 * `crates/lints/src/builtin_rule_descriptors.json`.
 */
export function builtInIndexRuleDescriptors(): readonly IndexRuleDescriptor[] {
  if (descriptorValidationErrors.length > 0) {
    throw new Error(
      `Invalid built-in Project Index rule descriptors:\n${descriptorValidationErrors.join('\n')}`,
    )
  }
  return fixture.descriptors.map(cloneDescriptor)
}

/**
 * Validates the generated built-in descriptor fixture.
 *
 * The function name is kept for existing plan/readiness checks, but the
 * validated input is now the Rust-generated descriptor JSON rather than a
 * TypeScript rule manifest table.
 */
export function validateBuiltInIndexRuleManifests(): readonly string[] {
  return descriptorValidationErrors
}

/** Narrows arbitrary strings to built-in lint rule ids from the Rust fixture. */
export function knownIndexLintRuleId(value: string): value is IndexLintRuleId {
  return descriptorIds.has(value)
}

function validateDescriptors(descriptors: readonly IndexRuleDescriptor[]): readonly string[] {
  const seen = new Set<string>()
  const errors: string[] = []

  for (const descriptor of descriptors) {
    const result = IndexRuleDescriptorSchema.safeParse(descriptor)
    if (!result.success) {
      errors.push(
        `${descriptor.id || '<unknown>'}: ${result.error.issues.map((issue) => issue.message).join(', ')}`,
      )
    }
    if (seen.has(descriptor.id)) {
      errors.push(`${descriptor.id}: duplicate built-in rule descriptor id`)
    }
    seen.add(descriptor.id)
  }

  return errors
}

function cloneDescriptor(descriptor: IndexRuleDescriptor): IndexRuleDescriptor {
  return {
    ...descriptor,
    profiles: descriptor.profiles ? [...descriptor.profiles] : undefined,
    requires: descriptor.requires ? [...descriptor.requires] : undefined,
    fixes: descriptor.fixes?.map((fix) => ({ ...fix })),
    suppression: descriptor.suppression ? { ...descriptor.suppression } : undefined,
  }
}
