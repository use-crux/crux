import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexSourceFile,
  ProjectDefinition,
  ProjectIdentity,
  ProjectIndexData,
} from "@/types";
import { assertPromptTextProjectIndexEvidence } from "@/shared/services/project-index/evidence";

/** A generation-stamped, per-anchor replacement from the local index hub. */
export interface IndexDeltaMessage {
  readonly type: "index:delta";
  readonly generation: number;
  readonly file: string;
  readonly definitions: {
    readonly added?: readonly ProjectDefinition[];
    readonly changed?: readonly ProjectDefinition[];
    readonly removedIds?: readonly string[];
  };
  readonly diagnostics?: readonly IndexDiagnostic[];
  readonly sourceRow?: IndexSourceFile | null;
  /** Complete replacement for lint findings anchored to the delta's `file`. */
  readonly lints?: {
    readonly findings: readonly IndexLintFinding[];
  };
}

/** Normalizes Project Index snapshots from REST or WebSocket payloads. */
export function normalizeProjectIndexData(
  index: Partial<ProjectIndexData>,
): ProjectIndexData {
  assertPromptTextProjectIndexEvidence(index);
  return {
    projectRoot: index.projectRoot,
    serverVersion: index.serverVersion,
    generation: index.generation,
    schemaVersion: index.schemaVersion ?? 1,
    prompts: index.prompts ?? [],
    contexts: index.contexts ?? [],
    tools: index.tools ?? [],
    project: normalizeProjectIdentity(index.project),
    indexedAt: index.indexedAt,
    indexing: index.indexing,
    definitions: index.definitions ?? [],
    relations: index.relations ?? [],
    diagnostics: index.diagnostics ?? [],
    lintFindings: index.lintFindings ?? [],
    sources: index.sources ?? [],
  };
}

function normalizeProjectIdentity(
  project: ProjectIdentity | undefined,
): ProjectIdentity | undefined {
  if (!isRecord(project) || typeof project.root !== "string") return undefined;
  const observability = isRecord(project.observability)
    ? project.observability
    : undefined;
  return {
    root: project.root,
    ...(typeof project.name === "string" ? { name: project.name } : {}),
    ...(typeof project.configFile === "string"
      ? { configFile: project.configFile }
      : {}),
    ...(typeof project.runtimeConfigured === "boolean"
      ? { runtimeConfigured: project.runtimeConfigured }
      : {}),
    ...(typeof observability?.redactPatternsConfigured === "boolean"
      ? {
          observability: {
            redactPatternsConfigured:
              observability.redactPatternsConfigured,
          },
        }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Applies one per-file Project Index delta to an existing cached snapshot. */
export function applyIndexDelta(
  current: ProjectIndexData | undefined,
  delta: IndexDeltaMessage,
): ProjectIndexData | undefined {
  if (!current) return undefined;
  assertPromptTextProjectIndexEvidence({
    definitions: [
      ...(delta.definitions.added ?? []),
      ...(delta.definitions.changed ?? []),
    ],
    diagnostics: delta.diagnostics,
  });
  return {
    ...current,
    definitions: applyDefinitionDelta(current.definitions, delta.definitions),
    diagnostics: applyDiagnosticDelta(
      current.diagnostics,
      delta.file,
      delta.diagnostics,
    ),
    lintFindings: applyLintDelta(current.lintFindings, delta.file, delta.lints),
    sources: applySourceDelta(current.sources, delta.file, delta.sourceRow),
  };
}

function applyDiagnosticDelta(
  current: readonly IndexDiagnostic[],
  file: string,
  diagnostics: IndexDeltaMessage["diagnostics"],
): IndexDiagnostic[] {
  if (diagnostics === undefined) return [...current];
  return [
    ...current.filter((diagnostic) => (diagnostic.source?.file ?? "") !== file),
    ...diagnostics,
  ];
}

function applyLintDelta(
  current: readonly IndexLintFinding[],
  file: string,
  lints: IndexDeltaMessage["lints"],
): IndexLintFinding[] {
  if (!lints) return [...current];
  return [
    ...current.filter((finding) => (finding.source?.file ?? "") !== file),
    ...lints.findings,
  ];
}

function applyDefinitionDelta(
  current: readonly ProjectDefinition[],
  delta: IndexDeltaMessage["definitions"],
): ProjectDefinition[] {
  const removed = new Set(delta.removedIds ?? []);
  const incoming = new Map<string, ProjectDefinition>();
  for (const definition of [...(delta.added ?? []), ...(delta.changed ?? [])]) {
    incoming.set(definition.id, definition);
  }

  const next: ProjectDefinition[] = [];
  for (const definition of current) {
    if (removed.has(definition.id)) continue;
    const replacement = incoming.get(definition.id);
    if (replacement) {
      next.push(replacement);
      incoming.delete(definition.id);
      continue;
    }
    next.push(definition);
  }
  next.push(...incoming.values());
  return next;
}

function applySourceDelta(
  current: readonly IndexSourceFile[],
  file: string,
  sourceRow: IndexDeltaMessage["sourceRow"],
): IndexSourceFile[] {
  if (sourceRow === undefined) return [...current];
  const next = current.filter((source) => source.file !== file);
  if (sourceRow !== null) next.push(sourceRow);
  next.sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  );
  return next;
}
