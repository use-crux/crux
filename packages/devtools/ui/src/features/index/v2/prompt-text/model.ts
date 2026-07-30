import type {
  IndexDiagnostic,
  ProjectSourceRef,
  PromptTextDiagnosticCause,
  PromptTextFragmentJoinEvidence,
  PromptTextSourceKind,
} from "@/types";
import type { ViewDef } from "../adapt";

export interface PromptTextSourceEvidenceView {
  readonly id: string;
  readonly role: ProjectSourceRef["role"];
  readonly sourceKind: PromptTextSourceKind;
  readonly sourceKindLabel: string;
  readonly lifecycleLabel: string;
  readonly joins: readonly PromptTextFragmentJoinEvidence[];
}

export interface PromptTextRefactorView {
  readonly id: string;
  readonly role: ProjectSourceRef["role"];
  readonly binding: string;
}

export interface PromptTextDiagnosticView {
  readonly id: string;
  readonly severity: IndexDiagnostic["severity"];
  readonly code: string;
  readonly message: string;
  readonly sourceRefId: string;
  readonly location?: string;
  readonly cause: string;
}

export interface PromptTextCatalogEvidence {
  readonly sources: readonly PromptTextSourceEvidenceView[];
  readonly refactors: readonly PromptTextRefactorView[];
  readonly diagnostics: readonly PromptTextDiagnosticView[];
}

const SOURCE_KIND_LABELS = {
  owner: "Owner",
  "named-fragment": "Named fragment",
  "anonymous-fragment": "Anonymous fragment",
} as const satisfies Record<PromptTextSourceKind, string>;

function describeCause(cause: PromptTextDiagnosticCause): string {
  switch (cause.kind) {
    case "invalid-interpolation":
      return `invalid interpolation · ${cause.runtimeKinds.join(", ")}${
        cause.mdJsonApplicable ? " · md.json available" : ""
      }`;
    case "inline-sequence":
      return `inline sequence${
        cause.joinableWithComma ? " · comma join available" : ""
      }`;
    case "json-serialization":
      return "JSON serialization · undefined result";
  }
}

function formatLocation(
  diagnostic: IndexDiagnostic,
  relPath: (file?: string) => string | undefined,
): string | undefined {
  const source = diagnostic.source;
  if (!source) return undefined;
  const file = relPath(source.file) ?? source.file;
  return `${file}:${source.line}${source.column ? `:${source.column}` : ""}`;
}

/**
 * Projects only complete PromptText records into the Catalog presentation.
 *
 * Ordinary source refs and unrelated hard diagnostics are intentionally
 * omitted so definitions without PromptText evidence keep their existing UI.
 */
export function promptTextCatalogEvidence(
  def: ViewDef,
  relPath: (file?: string) => string | undefined,
): PromptTextCatalogEvidence | undefined {
  const sources: PromptTextSourceEvidenceView[] = [];
  const refactors: PromptTextRefactorView[] = [];

  for (const sourceRef of def.sourceRefs ?? []) {
    const promptText = sourceRef.metadata?.promptText;
    if (promptText) {
      sources.push({
        id: sourceRef.id,
        role: sourceRef.role,
        sourceKind: promptText.sourceKind,
        sourceKindLabel: SOURCE_KIND_LABELS[promptText.sourceKind],
        lifecycleLabel:
          promptText.lifecycle === "static"
            ? "Static · direct"
            : "Dynamic · callback",
        joins: promptText.fragmentJoins ?? [],
      });
    }

    const refactor = sourceRef.metadata?.promptTextRefactor;
    if (refactor) {
      refactors.push({
        id: sourceRef.id,
        role: sourceRef.role,
        binding: refactor.binding.expression,
      });
    }
  }

  const diagnostics = (def.indexDiagnostics ?? []).flatMap(
    (diagnostic): readonly PromptTextDiagnosticView[] => {
      const evidence = diagnostic.evidence;
      if (evidence?.kind !== "prompt-text") return [];
      return [
        {
          id: diagnostic.id,
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          sourceRefId: evidence.sourceRefId,
          location: formatLocation(diagnostic, relPath),
          cause: describeCause(evidence.cause),
        },
      ];
    },
  );

  if (
    sources.length === 0 &&
    refactors.length === 0 &&
    diagnostics.length === 0
  )
    return undefined;
  return { sources, refactors, diagnostics };
}
