import {
  ProjectSourceRefSchema,
  PromptTextDiagnosticEvidenceSchema,
} from "@use-crux/core/project-index";
import type { IndexDiagnostic, ProjectDefinition } from "@/types";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rejects malformed compiler-owned PromptText records at Project Index wire
 * entry points while leaving unrelated extensible metadata untouched.
 */
export function assertPromptTextProjectIndexEvidence(index: {
  readonly definitions?: readonly ProjectDefinition[];
  readonly diagnostics?: readonly IndexDiagnostic[];
}): void {
  for (const definition of index.definitions ?? []) {
    for (const sourceRef of definition.sourceRefs ?? []) {
      const metadata: unknown = sourceRef.metadata;
      if (
        isRecord(metadata) &&
        (Object.hasOwn(metadata, "promptText") ||
          Object.hasOwn(metadata, "promptTextRefactor"))
      ) {
        ProjectSourceRefSchema.parse(sourceRef);
      }
    }
  }
  for (const diagnostic of index.diagnostics ?? []) {
    if (diagnostic.evidence !== undefined) {
      PromptTextDiagnosticEvidenceSchema.parse(diagnostic.evidence);
    }
  }
}
