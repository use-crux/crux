import type { RuntimeArtifactFinding } from "./types";

const HUMAN_FINDING_LIMIT = 5;

/** Aggregate generation failure retaining every deterministic child finding. */
export class RuntimeArtifactGenerationError extends Error {
  override readonly name = "RuntimeArtifactGenerationError";
  readonly code = "RUNTIME_ARTIFACT_GENERATION_FAILED";
  readonly findings: readonly RuntimeArtifactFinding[];
  override readonly cause?: unknown;

  constructor(
    findings: readonly RuntimeArtifactFinding[],
    options: { readonly cause?: unknown } = {},
  ) {
    const sorted = sortRuntimeArtifactFindings(findings);
    super(renderRuntimeArtifactFindings(sorted));
    this.findings = sorted;
    if ("cause" in options) this.cause = options.cause;
  }
}

export interface RuntimeArtifactFindingContext {
  readonly code?: string;
  readonly category?: RuntimeArtifactFinding["category"];
  readonly featureKind?: RuntimeArtifactFinding["featureKind"];
  readonly featureId?: string;
  readonly arm?: string;
  readonly source?: string;
  readonly summary?: string;
  readonly reason?: string;
  readonly whatStillWorks?: string;
  readonly remediation?: string;
  readonly docs?: string;
}

/** Preserve typed failures and classify unexpected values without blame. */
export function runtimeArtifactGenerationError(
  error: unknown,
  context: RuntimeArtifactFindingContext = {},
): RuntimeArtifactGenerationError {
  if (error instanceof RuntimeArtifactGenerationError) return error;
  return new RuntimeArtifactGenerationError(
    [runtimeArtifactFindingFromError(error, context)],
    { cause: error },
  );
}

/** Retain only unexpected internal causes across aggregate boundaries. */
export function runtimeArtifactInternalCauses(
  errors: readonly unknown[],
): readonly unknown[] {
  return Object.freeze(
    errors.flatMap((error) => {
      if (error instanceof RuntimeArtifactGenerationError) {
        if (error.cause === undefined) return [];
        return Array.isArray(error.cause) ? error.cause : [error.cause];
      }
      return runtimeArtifactFindingFromError(error).category === "internal"
        ? [error]
        : [];
    }),
  );
}

/** Project one thrown value into the stable generation finding contract. */
export function runtimeArtifactFindingFromError(
  error: unknown,
  context: RuntimeArtifactFindingContext = {},
): RuntimeArtifactFinding {
  const typed = runtimeErrorFields(error);
  const code = context.code ?? typed.code ?? nodeErrorCode(error);
  const category =
    context.category ?? categoryForCode(code) ?? unexpectedCategory(error);
  return omitUndefined({
    code: code ?? "RUNTIME_ARTIFACT_INTERNAL",
    category,
    featureKind: context.featureKind,
    featureId: context.featureId,
    arm: context.arm,
    source: context.source,
    summary:
      context.summary ??
      typed.summary ??
      "Crux could not prepare the Runtime artifacts.",
    reason: context.reason ?? typed.reason ?? errorMessage(error),
    whatStillWorks: context.whatStillWorks ?? typed.whatStillWorks,
    remediation: context.remediation ?? typed.remediation,
    docs: context.docs ?? typed.docs,
  });
}

/** Stable finding order independent of async discovery completion. */
export function sortRuntimeArtifactFindings(
  findings: readonly RuntimeArtifactFinding[],
): readonly RuntimeArtifactFinding[] {
  return Object.freeze(
    findings
      .map((finding) => Object.freeze({ ...finding }))
      .sort(
        (left, right) =>
          compareOptional(left.source, right.source) ||
          compareOptional(left.featureId, right.featureId) ||
          compareOptional(left.arm, right.arm) ||
          compareCodepoint(left.code, right.code) ||
          compareCodepoint(left.summary, right.summary) ||
          compareCodepoint(left.reason, right.reason),
      ),
  );
}

/** Bounded plain-text rendering; structured transports keep every finding. */
export function renderRuntimeArtifactFindings(
  findings: readonly RuntimeArtifactFinding[],
  limit = HUMAN_FINDING_LIMIT,
): string {
  const sorted = sortRuntimeArtifactFindings(findings);
  const visible = sorted.slice(0, Math.max(0, limit));
  const lines = [
    `Runtime artifacts could not be generated (${sorted.length} ${sorted.length === 1 ? "issue" : "issues"}).`,
  ];
  visible.forEach((finding, index) => {
    lines.push(`${index + 1}. [${finding.code}] ${finding.summary}`);
    lines.push(`   Why: ${finding.reason}`);
    if (finding.whatStillWorks) {
      lines.push(`   What still works: ${finding.whatStillWorks}`);
    }
    if (finding.remediation) lines.push(`   Fix: ${finding.remediation}`);
  });
  const remaining = sorted.length - visible.length;
  if (remaining > 0) lines.push(`... and ${remaining} more.`);
  return lines.join("\n");
}

function compareOptional(
  left: string | undefined,
  right: string | undefined,
): number {
  return compareCodepoint(left ?? "", right ?? "");
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runtimeErrorFields(error: unknown): {
  readonly code?: string;
  readonly summary?: string;
  readonly reason?: string;
  readonly whatStillWorks?: string;
  readonly remediation?: string;
  readonly docs?: string;
} {
  if (!isRecord(error)) return {};
  return omitUndefined({
    code: stringField(error, "code"),
    summary: stringField(error, "whatFailed"),
    reason: stringField(error, "why"),
    whatStillWorks: stringField(error, "whatStillWorks"),
    remediation: stringField(error, "nextStep"),
    docs: stringField(error, "docsUrl"),
  });
}

function categoryForCode(
  code: string | undefined,
): RuntimeArtifactFinding["category"] | undefined {
  switch (code) {
    case "TARGET_DUPLICATE":
    case "TARGET_NOT_EXPORTED":
    case "RUNTIME_EVAL_INVALID":
    case "RUNTIME_EVAL_IMPORT_FAILED":
    case "RUNTIME_EVAL_CASE_INVALID":
      return "authored";
    case "ARTIFACTS_STALE":
    case "SETUP_REQUIRED":
    case "RUNTIME_EVAL_TASK_CONTRACT_INCOMPATIBLE":
      return "configuration";
    case "EACCES":
    case "EIO":
    case "EISDIR":
    case "ENOENT":
    case "ENOSPC":
    case "EPERM":
    case "EROFS":
    case "RUNTIME_ARTIFACT_COMMIT_FAILED":
      return "environment";
    default:
      return undefined;
  }
}

function unexpectedCategory(
  error: unknown,
): RuntimeArtifactFinding["category"] {
  return nodeErrorCode(error) === undefined ? "internal" : "environment";
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.code;
  return typeof code === "string" && /^E[A-Z0-9_]+$/.test(code)
    ? code
    : undefined;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function omitUndefined<T extends Readonly<Record<string, unknown>>>(
  value: T,
): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
