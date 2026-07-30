import { primitiveEvidenceCoverage as row } from "./descriptor";

/** Handoff, project-state, runtime, defer, and custom audit rows. */
export const runtimeEvidenceCoverage = {
  "handoff.prepare": row({
    name: "handoff.prepare",
    participation: "subject",
  }),
  "delegate.invoke": row({
    name: "delegate.invoke",
    participation: "subject",
  }),
  "plan.operation": row({
    name: "plan.operation",
    participation: "subject",
    automaticRoles: {
      change: {
        producer: "plan/plans.emitPlanArtifact",
        sourceKinds: ["output"],
        conformanceTest:
          "packages/core/__tests__/evidence/native-plan-task.test.ts",
      },
    },
  }),
  "task.operation": row({
    name: "task.operation",
    participation: "subject",
    automaticRoles: {
      change: {
        producer: "plan/tasks.emitTaskArtifact",
        sourceKinds: ["output"],
        conformanceTest:
          "packages/core/__tests__/evidence/native-plan-task.test.ts",
      },
    },
  }),
  "workspace.operation": row({
    name: "workspace.operation",
    participation: "subject",
    automaticRoles: {
      change: {
        producer: "workspace/observability.emitWorkspaceArtifact",
        sourceKinds: ["output"],
        conformanceTest:
          "packages/core/__tests__/evidence/native-workspace.test.ts",
      },
    },
    blockedRoles: {
      recovery: "https://github.com/use-crux/crux/issues/258",
    },
  }),
  "indexing.pipeline": row({
    name: "indexing.pipeline",
    participation: "subject",
  }),
  "ingest.parse": row({
    name: "ingest.parse",
    participation: "subject",
  }),
  "corpus.sync": row({
    name: "corpus.sync",
    participation: "subject",
  }),
  "skill.load": row({
    name: "skill.load",
    participation: "subject",
  }),
  "security.warning": row({
    name: "security.warning",
    participation: "subject",
  }),
  "cost.record": row({
    name: "cost.record",
    participation: "consumer",
    notApplicableRoles: [
      "intent",
      "authority",
      "change",
      "verification",
      "recovery",
    ],
  }),
  "feedback.record": row({
    name: "feedback.record",
    participation: "consumer",
  }),
  "runtime.convex.action": row({
    name: "runtime.convex.action",
    participation: "subject",
  }),
  "runtime.convex.query": row({
    name: "runtime.convex.query",
    participation: "subject",
  }),
  "runtime.convex.mutation": row({
    name: "runtime.convex.mutation",
    participation: "subject",
  }),
  "runtime.convex.schedule": row({
    name: "runtime.convex.schedule",
    participation: "subject",
  }),
  "runtime.convex.resume": row({
    name: "runtime.convex.resume",
    participation: "subject",
  }),
  "runtime.convex.flush": row({
    name: "runtime.convex.flush",
    participation: "subject",
  }),
  "defer.scheduled": row({
    name: "defer.scheduled",
    participation: "subject",
  }),
  "defer.run": row({
    name: "defer.run",
    participation: "subject",
  }),
  "evidence.record": row({
    name: "evidence.record",
    participation: "producer",
  }),
  "custom.operation": row({
    name: "custom.operation",
    participation: "subject",
  }),
};
