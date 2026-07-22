import { expectTypeOf } from "vitest";
import type {
  IndexLintFinding,
  IndexLintSuppressedBy as ProjectIndexLintSuppressedBy,
  IndexLintSuppressionScope as ProjectIndexLintSuppressionScope,
} from "@use-crux/core/project-index";
import type {
  IndexLintSuppressedBy as LintSuppressedBy,
  IndexLintSuppressionScope as LintSuppressionScope,
} from "@use-crux/core/lint";

const active = {
  id: "lint:example",
  severity: "warning",
  ruleId: "example.rule",
  category: "quality",
  maturity: "stable",
  confidence: "high",
  profiles: ["recommended"],
  title: "Example rule",
  message: "Example finding",
  rationale: "Example rationale",
  relatedDefinitionIds: [],
  evidence: [],
  fixes: [],
  docsUrl: "https://use-crux.dev/lint/example.rule",
} satisfies IndexLintFinding;

const explicitlyActive = {
  ...active,
  suppressed: false,
} satisfies IndexLintFinding;

const suppressed = {
  ...active,
  suppressed: true,
  suppressedBy: {
    source: { file: "src/workflow.ts", line: 7, column: 3 },
    scope: "next-line",
    reason: "intentional handoff",
  },
} satisfies IndexLintFinding;

function suppressionReason(finding: IndexLintFinding): string | undefined {
  if (!finding.suppressed) return undefined;

  expectTypeOf(
    finding.suppressedBy,
  ).toEqualTypeOf<ProjectIndexLintSuppressedBy>();
  return finding.suppressedBy.reason;
}

const suppressionEvidence: ProjectIndexLintSuppressedBy = {
  source: { file: "src/workflow.ts", line: 7 },
  scope: "line",
};

// @ts-expect-error Suppressed findings require directive metadata.
const missingMetadata: IndexLintFinding = { ...active, suppressed: true };

// @ts-expect-error Active findings cannot carry suppression metadata.
const metadataWithoutSuppression: IndexLintFinding = {
  ...active,
  suppressedBy: suppressionEvidence,
};

// @ts-expect-error Explicitly active findings cannot carry suppression metadata.
const metadataWithFalse: IndexLintFinding = {
  ...active,
  suppressed: false,
  suppressedBy: suppressionEvidence,
};

const invalidScope: IndexLintFinding = {
  ...active,
  suppressed: true,
  suppressedBy: {
    source: { file: "src/workflow.ts", line: 7 },
    // @ts-expect-error Suppression scopes use the closed public vocabulary.
    scope: "next-lineage",
  },
};

declare const broadBoolean: boolean;
// @ts-expect-error A broad boolean must be narrowed before it can discriminate the union.
const ambiguousState: IndexLintFinding = {
  ...active,
  suppressed: broadBoolean,
};

expectTypeOf<ProjectIndexLintSuppressionScope>().toEqualTypeOf<LintSuppressionScope>();
expectTypeOf<ProjectIndexLintSuppressedBy>().toEqualTypeOf<LintSuppressedBy>();

void explicitlyActive;
void suppressed;
void suppressionReason;
void missingMetadata;
void metadataWithoutSuppression;
void metadataWithFalse;
void invalidScope;
void ambiguousState;
