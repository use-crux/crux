import { createProjectIndexDeploymentManifest } from "@use-crux/indexer/host";
import type { ProjectIndexWorkerRequest } from "../lib/project-indexer-request";
import {
  assertProjectIndexWorkerProtocolV3,
  writeArtifactEvent,
  type ProjectIndexWorkerWriter,
} from "./project-indexer-protocol";

declare const __CRUX_INDEXER_VERSION__: string;

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
  assertProjectIndexWorkerProtocolV3(req.protocolVersion);
  const result = createProjectIndexDeploymentManifest({
    projectId: req.projectId,
    projectRoot: req.root,
    definitions: req.definitions ?? [],
    relations: req.relations ?? [],
    provenance: {
      producerVersion: __CRUX_INDEXER_VERSION__,
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
