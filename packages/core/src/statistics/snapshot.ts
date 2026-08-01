import type { MutableUsage, OwnerState } from "./internal";
import type {
  ModelUsageStats,
  ScopeStats,
  StatisticsCoverage,
  StatisticsSnapshot,
} from "./types";

export function createSnapshot(state: OwnerState): StatisticsSnapshot {
  return deepFreeze({
    owner: { ...state.owner },
    at: new Date(state.updatedAt),
    cursor: state.cursor,
    scope: {
      usage: {
        ...usageValues(state.usage),
        coverage: usageCoverage(state.usage),
        byModel: Object.fromEntries(
          [...state.models].map(([model, usage]) => [model, modelUsage(usage)]),
        ),
        ...(state.otherModels
          ? { otherModels: modelUsage(state.otherModels) }
          : {}),
        modelAttribution: state.otherModels ? "truncated" : "complete",
      },
      timing: {
        startedAt: new Date(state.startedAt),
        updatedAt: new Date(state.updatedAt),
        ...(state.completedAt
          ? { completedAt: new Date(state.completedAt) }
          : {}),
        wallTimeMs: state.updatedAt.getTime() - state.startedAt.getTime(),
        activeTimeMs: state.activeTimeMs,
        suspendedTimeMs: state.suspendedTimeMs,
      },
      modelCalls: { ...state.modelCalls },
      tools: {
        total: copyTool(state.tools),
        byName: Object.fromEntries(
          [...state.toolsByName].map(([name, value]) => [
            name,
            copyTool(value),
          ]),
        ),
        ...(state.otherTools ? { otherNames: copyTool(state.otherTools) } : {}),
        nameAttribution: state.otherTools ? "truncated" : "complete",
      },
      work: {
        total: copyWork(state.work),
        byTarget: Object.fromEntries(
          [...state.workByTarget].map(([name, value]) => [
            name,
            copyWork(value),
          ]),
        ),
        ...(state.otherWork ? { otherTargets: copyWork(state.otherWork) } : {}),
        targetAttribution: state.otherWork ? "truncated" : "complete",
      },
      failures: {
        total: Object.values(state.failures).reduce(
          (sum, count) => sum + count,
          0,
        ),
        byKind: { ...state.failures },
      },
      approvals: { ...state.approvals },
      lifecycle: { ...state.lifecycle },
    },
  });
}

function modelUsage(usage: MutableUsage): ModelUsageStats {
  return {
    calls: usage.calls,
    ...usageValues(usage),
    coverage: usageCoverage(usage),
  };
}

function usageValues(usage: MutableUsage) {
  const {
    calls: _calls,
    tokenReports: _tokens,
    costReports: _cost,
    ...values
  } = usage;
  return values;
}

function usageCoverage(usage: MutableUsage): {
  tokens: StatisticsCoverage;
  cost: StatisticsCoverage;
} {
  return {
    tokens: coverage(usage.tokenReports, usage.calls),
    cost: coverage(usage.costReports, usage.calls),
  };
}

function coverage(reports: number, calls: number): StatisticsCoverage {
  if (reports === 0 || calls === 0) return "none";
  return reports >= calls ? "complete" : "partial";
}

function copyTool(value: ScopeStats["tools"]["total"]) {
  return { ...value };
}

function copyWork(value: ScopeStats["work"]["total"]) {
  return { ...value, current: { ...value.current } };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
