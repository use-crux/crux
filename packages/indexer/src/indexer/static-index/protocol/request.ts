/**
 * Static Index compiler request contracts.
 *
 * The JSON `method` values use the final `staticIndex*` wire strings shared
 * by TypeScript, Go, and Rust.
 *
 * @module
 */

import { z } from "zod";
import {
  STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  StaticIndexRunIdentitySchema,
} from "./identity";
import { staticIndexParserInterestFields } from "./interests";

const unknownArraySchema = z.array(z.unknown());

/**
 * Prepared lint suppression directive parsed from source before the Rust
 * compiler runs lint filtering.
 */
export const StaticIndexLintSuppressionSchema = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    scope: z.enum(["next-line", "line", "file"]),
    ruleId: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict();

/** Prepared Static Index lint suppression directive. */
export type StaticIndexLintSuppression = z.infer<
  typeof StaticIndexLintSuppressionSchema
>;

/** Static Index compiler method names used on the JSON-lines boundary. */
export type StaticIndexCompilerMethod =
  | "staticIndexPrepare"
  | "staticIndexAnalyze"
  | "staticIndexFinalize"
  | "staticIndexCompile";

/** Source file identity selected for Static Index planning. */
export const StaticIndexSourceFileSchema = z
  .object({
    file: z.string().min(1),
    sourceHash: z.string().min(1),
    cacheKey: z.string().min(1).optional(),
  })
  .strict();

/** Source file selected for Static Index planning. */
export type StaticIndexSourceFile = z.infer<typeof StaticIndexSourceFileSchema>;

/** Source file selected for Static Index analysis. */
export const StaticIndexFileInputSchema = z
  .object({
    file: z.string().min(1),
    sourceHash: z.string().min(1),
    sourceText: z.string().optional(),
  })
  .strict();

/** Source file input supplied to Static Index analysis. */
export type StaticIndexFileInput = z.infer<typeof StaticIndexFileInputSchema>;

/** Normalized Static Index source plan shared by prepare and analyze. */
export const StaticIndexPreparedPlanSchema = z
  .object({
    root: z.string().min(1),
    projectName: z.string().min(1).optional(),
    files: z.array(StaticIndexSourceFileSchema),
    /** Extraction owners inside the wider parse set. */
    primaryFiles: z.array(StaticIndexSourceFileSchema).optional(),
    cacheHits: z.array(StaticIndexSourceFileSchema),
    cacheMisses: z.array(StaticIndexSourceFileSchema),
    ...staticIndexParserInterestFields,
  })
  .strict();

/** Static Index source plan shared by compiler stages. */
export type StaticIndexPreparedPlan = z.infer<
  typeof StaticIndexPreparedPlanSchema
>;

const staticIndexRequestBase = {
  protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
  identity: StaticIndexRunIdentitySchema,
} as const;

/** Request for the Rust compiler to normalize source/cache planning input. */
export const StaticIndexPrepareRequestSchema = z
  .object({
    ...staticIndexRequestBase,
    method: z.literal("staticIndexPrepare"),
    root: z.string().min(1),
    projectName: z.string().min(1).optional(),
    configPath: z.string().min(1).optional(),
    files: z.array(StaticIndexSourceFileSchema),
    /** Extraction owners inside the wider parse set. */
    primaryFiles: z.array(StaticIndexSourceFileSchema).optional(),
    ...staticIndexParserInterestFields,
    cacheInputs: unknownArraySchema.optional(),
    extensionHost: z.unknown().optional(),
  })
  .strict();

/** Request for the Rust compiler to parse selected cache misses and emit facts/evidence. */
export const StaticIndexAnalyzeRequestSchema = z
  .object({
    ...staticIndexRequestBase,
    method: z.literal("staticIndexAnalyze"),
    stream: z.literal(true),
    plan: StaticIndexPreparedPlanSchema,
    files: z.array(StaticIndexFileInputSchema),
    extensionEvidenceInterests: z.unknown().optional(),
  })
  .strict();

/** Request for Static Index relation/rule/cache finalization. */
export const StaticIndexFinalizeRequestSchema = z
  .object({
    ...staticIndexRequestBase,
    method: z.literal("staticIndexFinalize"),
    stream: z.literal(true).optional(),
    nativeFacts: unknownArraySchema,
    extensionFacts: unknownArraySchema,
    /** Post-merge facts used by native lint evaluation but not re-emitted. */
    lintFacts: unknownArraySchema.optional(),
    relationSpecs: z.unknown().optional(),
    ruleResults: z.unknown().optional(),
    lintConfig: z.unknown().optional(),
    lintSuppressions: z.array(StaticIndexLintSuppressionSchema).optional(),
    emitBuiltinLints: z.boolean().optional(),
    patchPhase: z.enum(["ast", "semantic", "runtime", "quality"]).optional(),
    patchInvalidates: z.unknown().optional(),
    cache: z.unknown().optional(),
  })
  .strict();

/** Request for parse, relation/rule finalization, and streamed patch events. */
export const StaticIndexCompileRequestSchema = z
  .object({
    ...staticIndexRequestBase,
    method: z.literal("staticIndexCompile"),
    stream: z.literal(true),
    plan: StaticIndexPreparedPlanSchema,
    files: z.array(StaticIndexFileInputSchema),
    nativeFacts: unknownArraySchema,
    extensionFacts: unknownArraySchema,
    relationSpecs: z.unknown().optional(),
    lintConfig: z.unknown().optional(),
    lintSuppressions: z.array(StaticIndexLintSuppressionSchema).optional(),
    emitBuiltinLints: z.boolean().optional(),
  })
  .strict();

/** Static Index compiler request union. */
export const StaticIndexCompilerRequestSchema = z.discriminatedUnion("method", [
  StaticIndexPrepareRequestSchema,
  StaticIndexAnalyzeRequestSchema,
  StaticIndexFinalizeRequestSchema,
  StaticIndexCompileRequestSchema,
]);

/** Static Index compiler request. */
export type StaticIndexCompilerRequest = z.infer<
  typeof StaticIndexCompilerRequestSchema
>;

/** Parsed Static Index request or a JSON-safe validation error. */
export type ParsedStaticIndexCompilerRequest =
  | { readonly ok: true; readonly request: StaticIndexCompilerRequest }
  | { readonly ok: false; readonly error: string };

/**
 * Parse one JSON-line Static Index compiler request into a typed command.
 *
 * @param line - One JSONL request line from a compiler host.
 * @returns The parsed request or a compact validation error.
 */
export function parseStaticIndexCompilerRequest(
  line: string,
): ParsedStaticIndexCompilerRequest {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }

  const parsed = StaticIndexCompilerRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "invalid Static Index request",
    };
  }
  return { ok: true, request: parsed.data };
}
