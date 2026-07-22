/**
 * Reusable structured-output fixtures for the normalization work.
 *
 * These schemas and the fake structured adapter are authored once so the
 * capability compiler, optional lowering, decode manifest, validation ordering,
 * and provider slices can all drive the exact same authored Zod shapes and
 * provider payloads instead of re-deriving them per test.
 *
 * The fixtures cover the structured schema matrix: required primitives,
 * optional-only, genuine nullable, nullish, nested optional objects, optional
 * array elements, and the default/coerce/transform cases that prove
 * `result.object === safeParse.data`.
 *
 * @module
 */

import { z } from "zod";
import { adapter, prompt } from "@use-crux/core";
import type {
  AdapterResponse,
  AdapterSpec,
  StreamHandle,
} from "@use-crux/core/adapter";

// ─────────────────────────────────────────────────────────────────
// Authored Zod schema matrix (canonical inputs for the compiler)
// ─────────────────────────────────────────────────────────────────

/** A required primitive property: never removed, never nulled. */
export const requiredPrimitiveSchema = z.object({ name: z.string() });

/** An optional-only property: absent means absent (delete-null-sentinel case). */
export const optionalOnlySchema = z.object({ name: z.string().optional() });

/** A genuine nullable property: provider `null` is preserved, never deleted. */
export const genuineNullableSchema = z.object({ name: z.string().nullable() });

/** A nullish property: both missing and `null` are legal and preserved. */
export const nullishSchema = z.object({ name: z.string().nullish() });

/** A nested optional object, exercising recursive manifest occurrences. */
export const nestedOptionalObjectSchema = z.object({
  user: z.object({ email: z.string().optional() }).optional(),
});

/** An array of objects with an optional field, exercising wildcard manifest paths. */
export const optionalArrayElementSchema = z.object({
  items: z.array(z.object({ tag: z.string().optional() })),
});

/** A schema whose default must appear in `result.object` after validation. */
export const defaultSchema = z.object({
  answer: z.number(),
  source: z.string().default("unknown"),
});

/** A schema whose transform must reshape `result.object` after validation. */
export const transformSchema = z
  .object({ answer: z.number() })
  .transform((value) => ({ ...value, doubled: value.answer * 2 }));

/** A schema whose coercion must convert the provider string into a number. */
export const coercionSchema = z.object({ answer: z.coerce.number() });

// ─────────────────────────────────────────────────────────────────
// Fake structured adapter harness
// ─────────────────────────────────────────────────────────────────

interface FakeRawResponse {
  readonly id: string;
  readonly text: string;
}

/**
 * Build a bound Crux adapter whose provider call returns fixed structured text.
 *
 * The adapter mirrors a real single-turn provider closely enough to exercise the
 * full `generate()` structured path (schema wiring, safety session, object
 * finalization) while staying provider-agnostic and offline.
 *
 * @param responseText - The exact JSON text the fake provider "returns".
 */
export function createStructuredFakeAdapter(responseText: string) {
  const spec: AdapterSpec<object, FakeRawResponse, AsyncIterable<string>> = {
    providerId: "fake-structured",
    async call(_client, _args) {
      const raw: FakeRawResponse = { id: "structured-response", text: responseText };
      return { raw, extracted: responseFrom(raw) };
    },
    async stream(): Promise<StreamHandle<AsyncIterable<string>>> {
      return {
        rawStream: emptyStream(),
        extractTextDelta: (chunk) =>
          typeof chunk === "string" ? chunk : undefined,
        completion: async () => ({}),
      };
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings() {
      return {};
    },
    wrapOutputSchema() {
      return { response_format: "json" };
    },
  };

  return adapter(spec)({});
}

/**
 * Build a structured prompt around one authored output schema.
 *
 * @param id - Stable prompt id for the fixture.
 * @param output - The authored Zod output schema under test.
 */
export function structuredFixturePrompt<TOutput extends z.ZodType>(
  id: string,
  output: TOutput,
) {
  return prompt({
    id,
    input: z.object({ message: z.string() }),
    output,
    prompt: ({ input }) => input.message,
  });
}

function responseFrom(raw: FakeRawResponse): AdapterResponse {
  return {
    text: raw.text,
    responseId: raw.id,
    finishReason: "stop",
  };
}

async function* emptyStream(): AsyncIterable<string> {}
