/**
 * Public type contract for structured-output request wiring.
 *
 * The executable placement hook has been replaced by inert capability data:
 *  - `NativeChatProfile.structuredOutput.accepts` is a capability record.
 *  - The native request context carries the core-compiled, provider-compatible
 *    lowered JSON Schema as `outputSchema`.
 */

import { expectTypeOf } from "vitest";
import type {
  NativeChatProfile,
  NativeChatRequestContext,
} from "../src/adapter/native-chat/types";
import type {
  JsonSchemaObject,
  StructuredOutputCapabilities,
} from "../src/adapter";

// A concrete profile instance to probe. The last two type parameters default.
declare const profile: NativeChatProfile<
  unknown,
  unknown,
  AsyncIterable<unknown>,
  Record<string, never>
>;

// The profile exposes inert capability data, not an executable placement hook.
expectTypeOf(profile.structuredOutput).toEqualTypeOf<
  { readonly accepts: StructuredOutputCapabilities } | undefined
>();
// @ts-expect-error the executable placement hook has been removed.
void profile.outputSchema;

declare const requestContext: NativeChatRequestContext<Record<string, never>>;

// The request context carries the compiled, provider-compatible lowered schema.
expectTypeOf(requestContext.outputSchema).toEqualTypeOf<
  JsonSchemaObject | undefined
>();
