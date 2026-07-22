/**
 * Phase 1 desired-contract type assertions for RFC #224 structured output.
 *
 * These assertions pin the target public shape from `03-public-api-contract.md`
 * and are written so they compile GREEN today. Each `@ts-expect-error` marks a
 * member that does NOT yet exist; when the owning phase adds it, the directive
 * becomes "unused" and TypeScript fails, forcing that phase to delete the
 * directive and replace it with a positive assertion.
 *
 *  - `NativeChatProfile.structuredOutput.accepts` — added in phase 2/5.
 *  - Native request-context `outputSchema` (lowered JSON Schema) — added in phase 5.
 *
 * See contract `01-normalization-contract.md` for the capability record and the
 * lowered request context.
 */

import type {
  NativeChatProfile,
  NativeChatRequestContext,
} from "../src/adapter/native-chat/types";

// A concrete profile instance to probe. The last two type parameters default.
declare const profile: NativeChatProfile<
  unknown,
  unknown,
  AsyncIterable<unknown>,
  Record<string, never>
>;

// The current placement hook is an executable method that this rollout removes
// in favor of inert capability data. It still exists today.
type CurrentPlacementHook = NonNullable<typeof profile.outputSchema>;
const _placementIsFunction: CurrentPlacementHook = (_schema) => ({});
void _placementIsFunction;

// PHASE 2/5: remove this @ts-expect-error once `profile.structuredOutput.accepts`
// (inert StructuredOutputCapabilities) replaces the placement hook.
// @ts-expect-error desired-contract: profile.structuredOutput does not exist yet.
void profile.structuredOutput;

declare const requestContext: NativeChatRequestContext<Record<string, never>>;

// PHASE 5: remove this @ts-expect-error once the request context carries the
// core-compiled, provider-compatible lowered JSON Schema.
// @ts-expect-error desired-contract: request-context outputSchema does not exist yet.
void requestContext.outputSchema;
