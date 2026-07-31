import { primitiveEvidenceCoverage as row } from "./descriptor";

/** Composition, tool, MCP, retrieval, and embedding audit rows. */
export const orchestrationEvidenceCoverage = {
  "composition.parallel": row({
    name: "composition.parallel",
    participation: "subject",
  }),
  "composition.pipeline": row({
    name: "composition.pipeline",
    participation: "subject",
  }),
  "composition.consensus": row({
    name: "composition.consensus",
    participation: "subject",
  }),
  "composition.swarm": row({
    name: "composition.swarm",
    participation: "subject",
  }),
  "composition.branch": row({
    name: "composition.branch",
    participation: "subject",
  }),
  "composition.join": row({
    name: "composition.join",
    participation: "subject",
  }),
  "composition.vote": row({
    name: "composition.vote",
    participation: "subject",
  }),
  "tool.call": row({
    name: "tool.call",
    participation: "subject",
    automaticRoles: {
      intent: {
        producer: "adapter/tool/emission.emitToolCallArgsArtifact",
        sourceKinds: ["tool.args"],
        conformanceTest:
          "packages/core/__tests__/evidence/native-tool-intent.test.ts",
      },
    },
  }),
  "tool.approval": row({
    name: "tool.approval",
    participation: "producer",
    automaticRoles: {
      authority: {
        producer:
          "adapter/tool/approval-evidence.emitToolApprovalDecisionAuthority",
        sourceKinds: ["approval.request", "approval.decision"],
        conformanceTest:
          "packages/core/__tests__/observability/tool-approval-sdk-attempt.test.ts",
      },
    },
  }),
  "mcp.connect": row({
    name: "mcp.connect",
    participation: "subject",
  }),
  "mcp.discover": row({
    name: "mcp.discover",
    participation: "subject",
  }),
  "retrieval.pipeline": row({
    name: "retrieval.pipeline",
    participation: "subject",
  }),
  "retrieval.recipe": row({
    name: "retrieval.recipe",
    participation: "subject",
  }),
  "retrieval.retrieve": row({
    name: "retrieval.retrieve",
    participation: "subject",
  }),
  "retrieval.query": row({
    name: "retrieval.query",
    participation: "subject",
  }),
  "retrieval.stage": row({
    name: "retrieval.stage",
    participation: "subject",
  }),
  "retrieval.step": row({
    name: "retrieval.step",
    participation: "subject",
  }),
  "embedding.call": row({
    name: "embedding.call",
    participation: "subject",
  }),
};
