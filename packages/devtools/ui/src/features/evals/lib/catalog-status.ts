import type { EvalCatalogHostReadiness } from "../types";

export function hostReadinessPresentation(
  readiness: EvalCatalogHostReadiness | undefined,
): {
  readonly label: string;
  readonly tone: "muted" | "warn" | "danger" | "ok";
} {
  if (readiness === undefined) {
    return { label: "Runtime readiness unavailable", tone: "danger" };
  }
  if (readiness.status === "ready") {
    return readiness.mode === "local"
      ? { label: "Runs locally", tone: "muted" }
      : { label: "Runtime ready", tone: "ok" };
  }
  if (readiness.status === "setup-required") {
    return { label: "Runtime setup required", tone: "warn" };
  }
  if (readiness.status === "unverified") {
    return { label: "Runtime unverified", tone: "warn" };
  }
  return { label: "Runtime mismatch", tone: "danger" };
}

export function hostReadinessDetails(
  readiness: EvalCatalogHostReadiness | undefined,
): {
  readonly reason?: string;
  readonly metadata: readonly string[];
  readonly remedies: readonly string[];
} {
  if (readiness === undefined) {
    return {
      reason: "Crux could not determine Runtime readiness.",
      metadata: [],
      remedies: ["Run 'crux eval --plan' to verify this Eval's Runtime."],
    };
  }
  const metadata = [
    ...(readiness.deploymentId ? [`deployment ${readiness.deploymentId}`] : []),
    ...(readiness.hostKind ? [`host ${readiness.hostKind}`] : []),
  ];
  if (readiness.status === "ready") {
    return {
      metadata: [
        readiness.mode === "local" ? "local execution" : "deployed Runtime",
        ...metadata,
      ],
      remedies: [],
    };
  }
  if (readiness.status === "mismatch") {
    return {
      reason: readiness.reason,
      metadata,
      remedies: [readiness.remedy],
    };
  }
  return {
    reason: readiness.reason,
    metadata,
    remedies: readiness.remedies,
  };
}

export function currentArmStatus(
  run: {
    readonly definitionFingerprint: string;
    readonly cells: readonly {
      readonly variant: string;
      readonly status: string;
    }[];
    readonly gates?: {
      readonly results: readonly {
        readonly variantName: string;
        readonly passed: boolean;
      }[];
    };
  },
  currentDefinitionFingerprint: string,
): "passed" | "failed" | "incomplete" | "stale" | undefined {
  if (run.definitionFingerprint !== currentDefinitionFingerprint) {
    return "stale";
  }
  const cells = run.cells.filter((cell) => cell.variant === "current");
  if (cells.length === 0) return undefined;
  if (
    cells.some((cell) => cell.status === "errored" || cell.status === "skipped")
  )
    return "incomplete";
  if (
    cells.some(
      (cell) => cell.status === "failed" || cell.status === "timed_out",
    )
  )
    return "failed";
  const currentGates = run.gates?.results.filter(
    (gate) => gate.variantName === "current",
  );
  if (currentGates?.some((gate) => !gate.passed)) return "failed";
  return cells.every((cell) => cell.status === "passed")
    ? "passed"
    : "incomplete";
}
