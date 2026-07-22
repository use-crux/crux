import { z } from "zod";
import type {
  CruxLintConfig,
  CruxLintRuleConfig,
  IndexLintEvidence,
  IndexLintFinding,
  IndexLintFix,
  IndexLintSuppressedBy,
  IndexRuleDescriptor,
} from "./lint-types";
import {
  IndexFactKindSchema,
  IndexRuleBudgetSchema,
  IndexRuleFidelitySchema,
  IndexRulePhaseSchema,
} from "./rule-manifest";
import { SourceLocationSchema } from "./source";

export const CruxLintCategorySchema = z.enum([
  "contracts",
  "observability",
  "evals",
  "safety",
  "memory",
  "runtime",
  "composition",
  "quality",
]);

export const CruxLintMaturitySchema = z.enum([
  "stable",
  "preview",
  "experimental",
]);

export const CruxLintConfidenceSchema = z.enum(["high", "medium", "low"]);

export const CruxLintProfileSchema = z.enum([
  "recommended",
  "strict",
  "experimental",
]);

export const CruxLintSelectedProfileSchema = z.enum([
  "off",
  "recommended",
  "strict",
  "experimental",
]);

export const CruxLintRuleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(["info", "warning", "error"]).optional(),
}) satisfies z.ZodType<CruxLintRuleConfig>;

export const CruxLintConfigSchema = z.object({
  profile: CruxLintSelectedProfileSchema.optional(),
  rules: z.record(z.string(), CruxLintRuleConfigSchema).optional(),
}) satisfies z.ZodType<CruxLintConfig>;

export const IndexLintEvidenceSchema = z.object({
  kind: z.enum(["definition", "relation", "quality", "runtime", "source"]),
  label: z.string(),
  description: z.string().optional(),
  definitionId: z.string().optional(),
  relationId: z.string().optional(),
  source: SourceLocationSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<IndexLintEvidence>;

export const IndexLintFixSchema = z.object({
  title: z.string(),
  description: z.string(),
  kind: z.enum(["manual", "docs", "config", "suppress", "code-action"]),
  docsUrl: z.string().optional(),
  command: z.string().optional(),
  suppression: z.string().optional(),
}) satisfies z.ZodType<IndexLintFix>;

export const IndexLintSuppressionScopeSchema = z.enum([
  "next-line",
  "line",
  "file",
]);

export const IndexLintSuppressedBySchema = z.object({
  source: SourceLocationSchema,
  scope: IndexLintSuppressionScopeSchema,
  reason: z.string().optional(),
}) satisfies z.ZodType<IndexLintSuppressedBy>;

const IndexLintFindingBaseSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  ruleId: z.string(),
  category: CruxLintCategorySchema,
  maturity: CruxLintMaturitySchema,
  confidence: CruxLintConfidenceSchema,
  profiles: z.array(CruxLintProfileSchema),
  title: z.string(),
  message: z.string(),
  rationale: z.string(),
  impact: z.string().optional(),
  source: SourceLocationSchema.optional(),
  primaryDefinitionId: z.string().optional(),
  relatedDefinitionIds: z.array(z.string()),
  affectedDefinitionIds: z.array(z.string()).optional(),
  evidence: z.array(IndexLintEvidenceSchema),
  fixes: z.array(IndexLintFixSchema),
  docsUrl: z.string(),
  suppression: z
    .object({
      supported: z.boolean(),
      directive: z.string(),
      scope: IndexLintSuppressionScopeSchema,
    })
    .optional(),
  propagatedDefinitionIds: z.array(z.string()).optional(),
  propagationPaths: z
    .array(
      z.object({
        fromDefinitionId: z.string(),
        toDefinitionId: z.string(),
        relationTypes: z.array(z.string()),
      }),
    )
    .optional(),
});

export const IndexLintFindingSchema = z.union([
  IndexLintFindingBaseSchema.extend({
    suppressed: z.literal(true),
    suppressedBy: IndexLintSuppressedBySchema,
  }),
  IndexLintFindingBaseSchema.extend({
    suppressed: z.literal(false).optional(),
    suppressedBy: z.never().optional(),
  }),
]) satisfies z.ZodType<IndexLintFinding>;

export const AnalysisTierSchema = z.enum(["syntax", "index", "semantic"]);

export const IndexRuleDescriptorSchema = z.object({
  id: z.string(),
  source: z.enum(["builtin", "extension"]),
  extension: z
    .object({ name: z.string(), version: z.string().optional() })
    .optional(),
  severity: z.enum(["info", "warning", "error"]).optional(),
  category: CruxLintCategorySchema.optional(),
  maturity: CruxLintMaturitySchema.optional(),
  confidence: CruxLintConfidenceSchema.optional(),
  profiles: z.array(CruxLintProfileSchema).optional(),
  title: z.string(),
  description: z.string(),
  rationale: z.string().optional(),
  impact: z.string().optional(),
  docsUrl: z.string().optional(),
  fixes: z.array(IndexLintFixSchema).optional(),
  suppression: z
    .object({
      supported: z.boolean(),
      scope: IndexLintSuppressionScopeSchema,
      directive: z.string().optional(),
    })
    .optional(),
  phase: IndexRulePhaseSchema.optional(),
  requires: z.array(IndexFactKindSchema).optional(),
  fidelity: IndexRuleFidelitySchema.optional(),
  optionSchema: z.unknown().optional(),
  messageIds: z.array(z.string()).optional(),
  defaultOptions: z.unknown().optional(),
  budget: IndexRuleBudgetSchema.optional(),
}) satisfies z.ZodType<IndexRuleDescriptor>;
