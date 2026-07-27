/** Compact label and safe identifier derived from ingress provenance. */
export interface InputOriginFacts {
  source?: string;
  identifier?: string;
}

/** Return semantic display copy for known Safety targets with a safe fallback. */
export function safetyTargetLabel(target: string): string {
  switch (target) {
    case "model.input.text":
      return "Model input · Text";
    case "model.input.media":
      return "Model input · Media";
    case "model.input.tools":
      return "Model input · Tools";
    case "model.instructions":
      return "Model instructions";
    default:
      return target;
  }
}

/** Derive a source label and safe identifier from an unknown runtime origin. */
export function inputOriginFacts(value: unknown): InputOriginFacts {
  if (!isRecord(value) || typeof value.source !== "string") return {};
  const source = value.source;
  return {
    source: sourceLabel(source, value),
    ...identifierForOrigin(source, value),
  };
}

function sourceLabel(source: string, origin: Record<string, unknown>): string {
  switch (source) {
    case "user":
      return "User";
    case "tool":
      return "Tool";
    case "retrieval":
      return "Retrieval";
    case "memory":
      return origin.kind === "blackboard-context" ? "Blackboard" : "Memory";
    case "handoff":
      return "Handoff";
    case "feedback":
      return "Feedback";
    case "tool-definition":
      return origin.kind === "discovered" ? "Discovered tool" : "Authored tool";
    default:
      return "Other source";
  }
}

function identifierForOrigin(
  source: string | undefined,
  origin: Record<string, unknown> | undefined,
): { readonly identifier?: string } {
  if (!origin) return {};
  if (source === "tool")
    return joinedIdentifier(origin.toolName, origin.toolCallId);
  if (source === "retrieval" && typeof origin.retrieverId === "string") {
    return { identifier: origin.retrieverId };
  }
  if (source === "memory") {
    return joinedIdentifier(origin.memoryId, origin.boardId);
  }
  if (source === "handoff") return joinedIdentifier(origin.handoffId);
  if (source === "feedback" && typeof origin.attempt === "number") {
    return { identifier: `attempt ${origin.attempt}` };
  }
  if (source === "instructions") return joinedIdentifier(origin.contextId);
  if (source === "tool-definition") {
    return joinedIdentifier(
      origin.toolName,
      origin.sourceId,
      origin.sourceKind,
      descriptionLabel(origin.descriptionKind),
      depthLabel(origin.schemaDepth),
    );
  }
  return {};
}

function descriptionLabel(value: unknown): string | undefined {
  return value === "tool"
    ? "tool description"
    : value === "schema"
      ? "schema description"
      : undefined;
}

function depthLabel(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? `depth ${value}`
    : undefined;
}

function joinedIdentifier(...values: readonly unknown[]): {
  readonly identifier?: string;
} {
  const safe = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return safe.length > 0 ? { identifier: safe.join(" · ") } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
