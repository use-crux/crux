import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexSourceFile,
} from "@/types";

/** Builds one file-anchored compiler diagnostic for live-delta tests. */
export function diagnostic(id: string, file: string): IndexDiagnostic {
  return {
    id,
    severity: "info",
    code: "index.test",
    message: "Test diagnostic",
    source: { file, line: 1 },
  };
}

/** Builds one complete lint finding for live-delta tests. */
export function lintFinding(id: string, file?: string): IndexLintFinding {
  return {
    id,
    severity: "info",
    ruleId: "prompt.missing_input_schema",
    category: "contracts",
    maturity: "stable",
    confidence: "high",
    profiles: ["recommended"],
    title: "Prompt has no input schema",
    message: "The prompt has no input schema.",
    rationale: "Prompt inputs should be inspectable.",
    source: file ? { file, line: 1 } : undefined,
    relatedDefinitionIds: [],
    evidence: [],
    fixes: [],
    docsUrl: "https://cruxjs.dev/docs/lints/prompt-missing-input-schema",
  };
}

/** Builds one indexed source row for live-delta tests. */
export function sourceRow(file: string, definitionId: string): IndexSourceFile {
  return {
    file,
    status: "indexed",
    definitionIds: [definitionId],
  };
}
