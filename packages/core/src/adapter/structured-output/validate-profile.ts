/**
 * Capability profile validation.
 *
 * Runs a closed set of schema-independent coherence checks over a capability
 * profile. These are the combinations that can never represent a valid
 * structured output regardless of the authored schema, so they are rejected once
 * at profile definition rather than late during a specific compilation.
 *
 * @module
 */

import type { StructuredOutputCapabilities } from "./capabilities";
import { CruxInvalidCapabilityProfileError } from "./errors";

/**
 * Validate a capability profile, throwing on any contradictory combination.
 *
 * @param capabilities - The profile to validate.
 * @throws {CruxInvalidCapabilityProfileError} When one or more fields conflict.
 */
export function validateStructuredOutputCapabilities(
  capabilities: StructuredOutputCapabilities,
): void {
  const conflicts: string[] = [];

  if (typeof capabilities.id !== "string" || capabilities.id.trim() === "") {
    conflicts.push("id must be a non-empty string");
  }

  // Under `requiresAllProperties`, the only mechanism for an optional property
  // is the required+nullable lowering, which needs a null union on the wire.
  if (capabilities.requiresAllProperties && !capabilities.supportsNullable) {
    conflicts.push(
      "requiresAllProperties needs supportsNullable: optional-only properties " +
        "are lowered to required+nullable and cannot otherwise be represented",
    );
  }

  // Without `requiresAllProperties`, optional properties are represented by
  // omission from `required`, which requires native optional support.
  if (
    !capabilities.requiresAllProperties &&
    !capabilities.supportsOptionalProperties
  ) {
    conflicts.push(
      "supportsOptionalProperties must be true when requiresAllProperties is " +
        "false: otherwise optional properties cannot be represented at all",
    );
  }

  if (conflicts.length > 0) {
    throw new CruxInvalidCapabilityProfileError(
      typeof capabilities.id === "string" ? capabilities.id : "<invalid-id>",
      conflicts,
    );
  }
}
