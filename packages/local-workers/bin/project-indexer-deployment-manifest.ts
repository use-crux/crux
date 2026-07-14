import { createProjectIndexDeploymentManifest } from "@use-crux/indexer/host";
import type { ProjectIndexWorkerRequest } from "../lib/project-indexer-request";
import {
  assertProjectIndexWorkerProtocolV2,
  writeArtifactEvent,
  type ProjectIndexWorkerWriter,
} from "./project-indexer-protocol";

const PROJECT_INDEXER_PRODUCER_VERSION = "0.5.0";

/** Projects one completed worker snapshot through the authoritative manifest compiler. */
export async function writeDeploymentManifestArtifact(
  write: ProjectIndexWorkerWriter,
  req: ProjectIndexWorkerRequest,
): Promise<void> {
  if (!req.root) throw new Error("createDeploymentManifest requires root");
  if (!req.projectId)
    throw new Error("createDeploymentManifest requires projectId");
  if (!req.staticFrontend)
    throw new Error("createDeploymentManifest requires staticFrontend");
  if (
    req.semanticStatus !== "complete" &&
    req.semanticStatus !== "disabled" &&
    req.semanticStatus !== "partial"
  ) {
    throw new Error("createDeploymentManifest requires a valid semanticStatus");
  }
  assertProjectIndexWorkerProtocolV2(req.protocolVersion);
  const result = createProjectIndexDeploymentManifest({
    projectId: req.projectId,
    projectRoot: req.root,
    definitions: req.definitions ?? [],
    relations: req.relations ?? [],
    provenance: {
      producerVersion: PROJECT_INDEXER_PRODUCER_VERSION,
      staticFrontend: req.staticFrontend,
      ...(req.manifestSemanticBackend
        ? { semanticBackend: req.manifestSemanticBackend }
        : {}),
      semanticStatus: req.semanticStatus,
    },
  });
  await writeArtifactEvent(
    write,
    "deploymentManifest",
    result.manifest,
    req.root,
  );
}
