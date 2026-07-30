import {
  PromptTextDiagnosticEvidenceSchema,
  type IndexDiagnostic,
  type PromptTextDiagnosticEvidence,
  type PromptTextRuntimeKind,
} from "@use-crux/core/project-index";
import { createPromptTextDiagnosticId } from "./prompt-text-diagnostic-id";
import { compareCodepoint } from "../../sort";

const MAX_U32 = 0xffff_ffff;

type PromptTextDiagnosticOwner =
  | {
      readonly role: "prompt";
      readonly property: "prompt";
      readonly lifecycle: "static" | "dynamic";
    }
  | {
      readonly role: "system";
      readonly property: "system";
      readonly lifecycle: "static" | "dynamic";
    };

interface PromptTextDiagnosticConclusionBase {
  readonly kind: "prompt-text-diagnostic";
  readonly definitionId: string;
  readonly sourceRefId: string;
  readonly owner: PromptTextDiagnosticOwner;
  readonly proof: "semantic-exact";
}

/** Exact one-based UTF-16 source point proven by a semantic backend. */
export interface PromptTextDiagnosticPoint {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** Template-local interpolation identity and exact authored expression point. */
export interface PromptTextInterpolationPoint {
  readonly index: number;
  readonly source: PromptTextDiagnosticPoint;
}

/**
 * Compiler-free PromptText construction conclusion.
 *
 * Backends may inspect their own compiler objects while constructing this
 * record, but only this closed union crosses into shared evidence projection.
 * Paths are unrepresentable for causes that always concern the whole
 * interpolation.
 */
export type PromptTextDiagnosticConclusion =
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: readonly number[];
      };
      readonly cause: {
        readonly kind: "invalid-interpolation";
        readonly runtimeKinds: readonly PromptTextRuntimeKind[];
        readonly mdJsonApplicable?: true;
      };
    })
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: never;
      };
      readonly cause: {
        readonly kind: "inline-sequence";
        readonly joinableWithComma?: true;
      };
    })
  | (PromptTextDiagnosticConclusionBase & {
      readonly interpolation: PromptTextInterpolationPoint & {
        readonly path?: never;
      };
      readonly cause: {
        readonly kind: "json-serialization";
        readonly reason: "undefined-result";
      };
    });

/**
 * Sorts, deduplicates, and projects normalized PromptText conclusions.
 *
 * Invalid identity inputs are suppressed rather than truncated. At most one
 * diagnostic survives for each owning definition, source ref, and
 * interpolation; JSON serialization wins, followed by the first required
 * invalid tuple path, then inline sequence evidence.
 *
 * @param conclusions - Compiler-free conclusions from one semantic backend.
 * @returns Deterministic Project Index diagnostics in authored source order.
 */
export function projectPromptTextDiagnosticConclusions(
  conclusions: readonly PromptTextDiagnosticConclusion[],
): readonly IndexDiagnostic[] {
  const candidates = conclusions.flatMap((conclusion) => {
    const diagnostic = projectConclusion(conclusion);
    return diagnostic ? [{ conclusion, diagnostic }] : [];
  });
  candidates.sort((left, right) =>
    compareConclusion(left.conclusion, right.conclusion),
  );
  const retained = new Map<string, (typeof candidates)[number]>();

  for (const candidate of candidates) {
    const { conclusion } = candidate;
    const key = conclusionKey(conclusion);
    const existing = retained.get(key);
    if (!existing || compareWinner(conclusion, existing.conclusion) < 0) {
      retained.set(key, candidate);
    }
  }

  return [...retained.values()]
    .sort((left, right) => compareConclusion(left.conclusion, right.conclusion))
    .map(({ diagnostic }) => diagnostic);
}

function projectConclusion(
  conclusion: PromptTextDiagnosticConclusion,
): IndexDiagnostic | undefined {
  const evidence = diagnosticEvidence(conclusion);
  const parsedEvidence = PromptTextDiagnosticEvidenceSchema.safeParse(evidence);
  const code = diagnosticCode(conclusion);
  const message = diagnosticMessage(conclusion);
  const id = createPromptTextDiagnosticId(conclusion, code);
  if (
    !id ||
    !parsedEvidence.success ||
    !conclusion.definitionId ||
    !conclusion.sourceRefId ||
    conclusion.owner.role !== conclusion.owner.property ||
    !validPoint(conclusion.interpolation.source)
  ) {
    return undefined;
  }
  return {
    id,
    severity: "error",
    code,
    message,
    source: { ...conclusion.interpolation.source },
    relatedDefinitionIds: [conclusion.definitionId],
    evidence: parsedEvidence.data,
  };
}

function diagnosticEvidence(
  conclusion: PromptTextDiagnosticConclusion,
): PromptTextDiagnosticEvidence {
  return {
    kind: "prompt-text",
    sourceRefId: conclusion.sourceRefId,
    interpolationIndex: conclusion.interpolation.index,
    ...("path" in conclusion.interpolation &&
    conclusion.interpolation.path !== undefined
      ? { interpolationPath: conclusion.interpolation.path }
      : {}),
    proof: conclusion.proof,
    cause: conclusion.cause,
  };
}

function diagnosticCode(conclusion: PromptTextDiagnosticConclusion): string {
  switch (conclusion.cause.kind) {
    case "invalid-interpolation":
      return "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION";
    case "inline-sequence":
      return "CRUX_PROMPT_TEXT_INLINE_SEQUENCE";
    case "json-serialization":
      return "CRUX_PROMPT_TEXT_JSON_SERIALIZATION";
  }
}

function diagnosticMessage(conclusion: PromptTextDiagnosticConclusion): string {
  switch (conclusion.cause.kind) {
    case "invalid-interpolation": {
      const path = (conclusion.interpolation.path ?? [])
        .map((part) => `[${part}]`)
        .join("");
      return `PromptText interpolation ${conclusion.interpolation.index}${path} is always invalid (${conclusion.cause.runtimeKinds.join(", ")}). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.`;
    }
    case "inline-sequence":
      return `PromptText interpolation ${conclusion.interpolation.index} is a sequence in inline position. Move it to its own line or join supported scalar values explicitly.`;
    case "json-serialization":
      return "md.json() cannot produce text because JSON.stringify() is proven to return undefined for this value.";
  }
}

function validPoint(point: PromptTextDiagnosticPoint): boolean {
  return (
    point.file.length > 0 &&
    Number.isInteger(point.line) &&
    point.line >= 1 &&
    point.line <= MAX_U32 &&
    Number.isInteger(point.column) &&
    point.column >= 1 &&
    point.column <= MAX_U32
  );
}

function conclusionKey(conclusion: PromptTextDiagnosticConclusion): string {
  return [
    conclusion.definitionId,
    conclusion.sourceRefId,
    conclusion.interpolation.index,
  ].join("\0");
}

function compareWinner(
  left: PromptTextDiagnosticConclusion,
  right: PromptTextDiagnosticConclusion,
): number {
  return (
    causeRank(left) - causeRank(right) ||
    comparePath(left.interpolation.path, right.interpolation.path)
  );
}

function compareConclusion(
  left: PromptTextDiagnosticConclusion,
  right: PromptTextDiagnosticConclusion,
): number {
  return (
    compareCodepoint(
      left.interpolation.source.file,
      right.interpolation.source.file,
    ) ||
    left.interpolation.source.line - right.interpolation.source.line ||
    left.interpolation.source.column - right.interpolation.source.column ||
    compareCodepoint(left.definitionId, right.definitionId) ||
    compareCodepoint(left.sourceRefId, right.sourceRefId) ||
    left.interpolation.index - right.interpolation.index ||
    comparePath(left.interpolation.path, right.interpolation.path) ||
    causeRank(left) - causeRank(right)
  );
}

function comparePath(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): number {
  const leftPath = left ?? [];
  const rightPath = right ?? [];
  for (
    let index = 0;
    index < Math.min(leftPath.length, rightPath.length);
    index++
  ) {
    const difference = (leftPath[index] ?? 0) - (rightPath[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPath.length - rightPath.length;
}

function causeRank(conclusion: PromptTextDiagnosticConclusion): number {
  return {
    "json-serialization": 0,
    "invalid-interpolation": 1,
    "inline-sequence": 2,
  }[conclusion.cause.kind];
}
