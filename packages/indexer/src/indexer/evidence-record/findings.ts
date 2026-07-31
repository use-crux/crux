import type {
  EvidenceRecordFacts,
  IndexLintFinding,
  ProjectDefinition,
} from "@use-crux/core/project-index";

type EvidenceRuleId =
  | "evidence.invalid-custom-kind"
  | "evidence.reserved-inline-kind";

/** Emits conclusive authored-evidence findings from byte-safe definition facts. */
export function evidenceRecordFindings(
  definition: ProjectDefinition,
): readonly IndexLintFinding[] {
  const facts = definition.metadata?.facts as EvidenceRecordFacts | undefined;
  if (facts?.kind !== "evidence.record") return [];
  if (facts.evidenceKind.classification === "invalid") {
    return [
      finding(
        "evidence.invalid-custom-kind",
        definition,
        "Evidence kind must be canonical or a valid bounded custom.* value.",
      ),
    ];
  }
  if (
    facts.sourceForm === "inline" &&
    facts.evidenceKind.classification === "canonical"
  ) {
    return [
      finding(
        "evidence.reserved-inline-kind",
        definition,
        "Canonical evidence kinds are reserved for existing references; inline evidence requires custom.*.",
      ),
    ];
  }
  return [];
}

function finding(
  ruleId: EvidenceRuleId,
  definition: ProjectDefinition,
  message: string,
): IndexLintFinding {
  const source = definition.source;
  return {
    id: `${ruleId}:${definition.id}`,
    ruleId,
    severity: "error",
    category: "contracts",
    maturity: "experimental",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: ruleId,
    message,
    rationale:
      "The compiler proved this invalid evidence authoring shape from a canonical evidence.record() call.",
    impact:
      "Runtime evidence authoring rejects this call before collector mutation.",
    ...(source ? { source } : {}),
    primaryDefinitionId: definition.id,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "definition",
        label: "Authored execution-evidence call",
        definitionId: definition.id,
        ...(source ? { source } : {}),
        data: { fidelity: definition.fidelity },
      },
    ],
    fixes: [
      {
        title: "Use a valid evidence kind",
        description:
          "Use a bounded custom.* kind for inline data or reference an existing canonical artifact.",
        kind: "manual",
      },
    ],
    docsUrl: "https://cruxjs.dev/docs/reference/evidence",
  };
}
