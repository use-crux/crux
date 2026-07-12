import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";

/** Emits graph-level media findings only when authored facts prove the condition. */
export function mediaArchitectureLintFindings(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): readonly IndexLintFinding[] {
  const findings: IndexLintFinding[] = [];
  for (const definition of definitions) {
    if (definition.kind !== "ingest.source") continue;
    const facts = record(definition.metadata?.facts);
    const mediaKinds = stringArray(facts?.mediaKinds);
    const derivations = relations.filter(
      (relation) =>
        relation.type === "media.derives_with" &&
        relation.from === definition.id,
    );
    if (
      mediaKinds.some((kind) => kind !== "text") &&
      derivations.length === 0
    ) {
      findings.push(
        graphFinding(
          "media.missing-derivation",
          definition,
          "Bind a describe or transcribe operation.",
        ),
      );
    }
    const attribution = stringArray(facts?.attribution);
    if (
      attribution.length > 0 &&
      derivations.some(
        (relation) => record(relation.metadata)?.attributionPreserved === false,
      )
    ) {
      findings.push(
        graphFinding(
          "media.missing-attribution",
          definition,
          "Preserve page or time attribution on derived text.",
        ),
      );
    }
  }
  return findings;
}

function graphFinding(
  ruleId: string,
  definition: ProjectDefinition,
  remediation: string,
): IndexLintFinding {
  return {
    id: `${ruleId}:${definition.id}`,
    ruleId,
    severity: "warning",
    category: "quality",
    maturity: "experimental",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: ruleId,
    message: `Authored media evidence triggered ${ruleId}.`,
    rationale:
      "The compiler proved this condition from resolved authored architecture.",
    impact:
      "Searchable media evidence may be incomplete or lose source attribution.",
    ...(definition.source ? { source: definition.source } : {}),
    primaryDefinitionId: definition.id,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "definition",
        label: "Resolved media architecture",
        definitionId: definition.id,
        ...(definition.source ? { source: definition.source } : {}),
        data: { source: "index", fidelity: definition.fidelity },
      },
    ],
    fixes: [
      {
        title: "Correct the media ingest binding",
        description: remediation,
        kind: "manual",
      },
    ],
    docsUrl: "https://cruxjs.dev/docs/guides/multimodal",
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
