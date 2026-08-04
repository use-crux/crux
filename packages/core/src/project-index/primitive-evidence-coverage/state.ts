import { primitiveEvidenceCoverage as row } from "./descriptor";

/** State, safety, routing, cache, and evaluation audit rows. */
export const stateEvidenceCoverage = {
  "memory.capture": row({
    name: "memory.capture",
    participation: "subject",
  }),
  "memory.read": row({
    name: "memory.read",
    participation: "subject",
  }),
  "memory.write": row({
    name: "memory.write",
    participation: "subject",
    automaticRoles: {
      change: {
        producer: "memory/block-system.emitMemoryObservation",
        sourceKinds: ["memory.diff"],
        conformanceTest:
          "packages/core/__tests__/evidence/native-memory.test.ts",
      },
    },
  }),
  "constraint.check": row({
    name: "constraint.check",
    participation: "subject",
  }),
  "constraint.retry": row({
    name: "constraint.retry",
    participation: "subject",
  }),
  "guardrail.run": row({
    name: "guardrail.run",
    participation: "subject",
  }),
  "thread.operation": row({
    name: "thread.operation",
    participation: "subject",
  }),
  "session.turn": row({
    name: "session.turn",
    participation: "subject",
  }),
  "routing.router": row({
    name: "routing.router",
    participation: "subject",
  }),
  "routing.split": row({
    name: "routing.split",
    participation: "subject",
  }),
  "routing.retry": row({
    name: "routing.retry",
    participation: "subject",
  }),
  "routing.cascade": row({
    name: "routing.cascade",
    participation: "subject",
  }),
  "routing.fallback": row({
    name: "routing.fallback",
    participation: "subject",
  }),
  "cache.lookup": row({
    name: "cache.lookup",
    participation: "subject",
  }),
  "compaction.run": row({
    name: "compaction.run",
    participation: "subject",
  }),
  "eval.run": row({
    name: "eval.run",
    participation: "subject",
  }),
  "eval.case": row({
    name: "eval.case",
    participation: "subject",
  }),
  "scoring.judge": row({
    name: "scoring.judge",
    participation: "subject",
  }),
  "citation.check": row({
    name: "citation.check",
    participation: "subject",
  }),
};
