import type {
  CruxObservabilityRedactionEvidence,
  CruxRunDetail,
  CruxRunDetailArtifact,
  CruxRunDetailDetail,
  CruxRunDetailNode,
} from "../src/observability";

declare const runDetail: CruxRunDetail;
declare const node: CruxRunDetailNode;
declare const detail: CruxRunDetailDetail;
declare const artifact: CruxRunDetailArtifact;

const runEvidence: CruxObservabilityRedactionEvidence | undefined =
  runDetail.redaction;
const nodeEvidence: CruxObservabilityRedactionEvidence | undefined =
  node.redaction;
const detailEvidence: CruxObservabilityRedactionEvidence | undefined =
  detail.redaction;
const artifactEvidence: CruxObservabilityRedactionEvidence | undefined =
  artifact.redaction;

// @ts-expect-error Presentation evidence remains readonly graph evidence.
runDetail.redaction?.surfaces.push("attributes");
const invalid: CruxObservabilityRedactionEvidence = {
  applied: true,
  // @ts-expect-error Presentation evidence uses the closed graph vocabulary.
  surfaces: ["prompt.text"],
};

void [
  runEvidence,
  nodeEvidence,
  detailEvidence,
  artifactEvidence,
  invalid,
];
