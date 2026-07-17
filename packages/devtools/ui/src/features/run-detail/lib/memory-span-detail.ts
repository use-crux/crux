import type { ObservabilityRunDetailNode } from "@/types";
import { findAttribute } from "./span-detail-inspection";

export interface MemoryBudgetDecision {
  maxTokens?: number;
  usedTokens?: number;
  included: string[];
  trimmed: string[];
  dropped: string[];
}

export function memoryRenderBudgetDecision(
  snapshot: Record<string, unknown> | undefined,
  node: ObservabilityRunDetailNode,
): MemoryBudgetDecision | null {
  const budget =
    snapshot?.budget &&
    typeof snapshot.budget === "object" &&
    !Array.isArray(snapshot.budget)
      ? (snapshot.budget as Record<string, unknown>)
      : undefined;
  const maxTokens = numberFrom(
    budget?.maxTokens ?? findAttribute(node, "budgetMaxTokens"),
  );
  const usedTokens = numberFrom(
    budget?.usedTokens ?? findAttribute(node, "budgetUsedTokens"),
  );
  const included = stringArrayFrom(
    budget?.includedBlocks ?? findAttribute(node, "budgetIncludedBlocks"),
  );
  const trimmed = stringArrayFrom(
    budget?.trimmedBlocks ?? findAttribute(node, "budgetTrimmedBlocks"),
  );
  const dropped = stringArrayFrom(
    budget?.droppedBlocks ?? findAttribute(node, "budgetDroppedBlocks"),
  );
  if (
    maxTokens == null &&
    usedTokens == null &&
    included.length === 0 &&
    trimmed.length === 0 &&
    dropped.length === 0
  ) {
    return null;
  }
  return { maxTokens, usedTokens, included, trimmed, dropped };
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
