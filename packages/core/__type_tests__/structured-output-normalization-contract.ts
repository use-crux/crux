/**
 * Desired-contract type assertions for structured-output compilation.
 *
 * These assertions pin the target public shape and compile GREEN today. Each
 * `@ts-expect-error` marks a member that does NOT yet exist; when it is added,
 * the directive becomes "unused" and TypeScript fails, forcing the change that
 * adds the member to also delete the directive and replace it with a positive
 * assertion.
 *
 *  - `NativeChatProfile.structuredOutput.accepts` — inert capability record that
 *    replaces the executable placement hook.
 *  - Native request-context `outputSchema` — the core-compiled, provider-
 *    compatible lowered JSON Schema supplied to the request builder.
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

// The current placement hook is an executable method that this work removes in
// favor of inert capability data. It still exists today.
type CurrentPlacementHook = NonNullable<typeof profile.outputSchema>;
const _placementIsFunction: CurrentPlacementHook = (_schema) => ({});
void _placementIsFunction;

// Remove this directive once `profile.structuredOutput.accepts` (inert
// StructuredOutputCapabilities) replaces the placement hook.
// @ts-expect-error desired-contract: profile.structuredOutput does not exist yet.
void profile.structuredOutput;

declare const requestContext: NativeChatRequestContext<Record<string, never>>;

// Remove this directive once the request context carries the core-compiled,
// provider-compatible lowered JSON Schema.
// @ts-expect-error desired-contract: request-context outputSchema does not exist yet.
void requestContext.outputSchema;
