import type {
  IndexLintFinding,
  ProjectDefinition,
  SignalProviderFacts,
  SignalTransportBindingFacts,
} from "@use-crux/core/project-index";

type SignalRuleId =
  | "signal.provider.unstable_identity"
  | "signal.transportBinding.unstable_identity"
  | "signal.transportBinding.live_value";

/** Emits conclusive Signal provider/binding findings from byte-safe facts. */
export function signalProviderFindings(
  definition: ProjectDefinition,
): readonly IndexLintFinding[] {
  const facts = definition.metadata?.facts as
    | SignalProviderFacts
    | SignalTransportBindingFacts
    | undefined;
  if (!facts) return [];

  if (facts.kind === "signal.provider" && facts.identity === "partial") {
    return [
      finding(
        "signal.provider.unstable_identity",
        definition,
        "Signal provider identity is not a static non-empty string literal.",
        "Pass a direct string literal to signalProvider({ id }) so generated Runtime programs can import stable provider authority.",
      ),
    ];
  }

  if (facts.kind !== "signal.transportBinding") return [];
  const findings: IndexLintFinding[] = [];
  if (facts.liveFields && facts.liveFields.length > 0) {
    findings.push(
      finding(
        "signal.transportBinding.live_value",
        definition,
        `Managed transport binding declares live value field(s): ${facts.liveFields.join(", ")}.`,
        "Remove Request, client, credential, socket, callback, handle, and onEvent fields from managedTransportBinding() options. Keep only id, configRef, signalId, and optional adapter/provider identities.",
      ),
    );
  }
  if (facts.identity === "partial") {
    findings.push(
      finding(
        "signal.transportBinding.unstable_identity",
        definition,
        "Managed transport binding identity, provider, Signal target, or config reference is not statically proven.",
        "Pass literal binding id, configRef, and signalId values, and bind an authored signalProvider() so generated Runtime programs can validate provider authority.",
      ),
    );
  }
  return findings;
}

function finding(
  ruleId: SignalRuleId,
  definition: ProjectDefinition,
  message: string,
  remediation: string,
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
      "Generated Runtime programs require secret-free, stable Signal provider and transport binding identities.",
    impact:
      "Unstable or live binding declarations fail Runtime program generation or worker start before managed-transport drain.",
    ...(source ? { source } : {}),
    primaryDefinitionId: definition.id,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "definition",
        label:
          definition.kind === "signal.provider"
            ? "Authored Signal provider declaration"
            : "Authored managed transport binding declaration",
        definitionId: definition.id,
        ...(source ? { source } : {}),
        data: { fidelity: definition.fidelity },
      },
    ],
    fixes: [
      {
        title: "Use a stable inert binding shape",
        description: remediation,
        kind: "manual",
      },
    ],
    docsUrl: "https://cruxjs.dev/docs/reference/signal",
  };
}
