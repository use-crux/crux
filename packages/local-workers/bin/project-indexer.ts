#!/usr/bin/env tsx

/**
 * Stdio wrapper for Project Index indexing.
 *
 * Protocol: one JSON request per line on stdin, V2 NDJSON worker events on stdout.
 */

import { createInterface } from "node:readline";
import {
  generateRuntimeArtifacts,
  inspectProjectStaticIndexConfig,
  inspectProjectStaticSyntaxPlan,
  inspectProjectConfig,
  resolveProjectModel,
  runRuntimeOperation,
  runSetupOperation,
} from "@use-crux/indexer/host";
import {
  isProjectModelResolutionMode,
  type ProjectModelResolutionMode,
} from "@use-crux/core/project-index";
import {
  createProjectIndexWorkerRequestAssembler,
  type ProjectIndexWorkerRequest,
} from "../lib/project-indexer-request";
import {
  assertProjectIndexWorkerProtocolV2,
  errorContextForMethod,
  writeArtifactEvent,
  writeProjectIndexArtifactError,
  writeProjectIndexPhaseError,
  type ProjectIndexWorkerErrorContext,
} from "./project-indexer-protocol";
import { writeStaticHostArtifactRequest } from "./project-indexer-static-host";
import { isRuntimeOperationKind } from "../lib/runtime-operation-kind";
import { writeDeploymentManifestArtifact } from "./project-indexer-deployment-manifest";

const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

let pending = 0;
let closing = false;
let lineQueue = Promise.resolve();

const assembleProjectIndexWorkerRequest =
  createProjectIndexWorkerRequestAssembler();

function maybeExit(): void {
  if (closing && pending === 0) process.exit(0);
}

async function writeResponse(value: unknown): Promise<void> {
  const line = JSON.stringify(value) + "\n";
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(line, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

rl.on("line", (line: string) => {
  pending += 1;
  lineQueue = lineQueue
    .then(
      () => handleLine(line),
      () => handleLine(line),
    )
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[project-indexer] unhandled error: ${message}\n`);
    })
    .finally(() => {
      pending -= 1;
      maybeExit();
    });
  void lineQueue;
});

async function handleLine(line: string): Promise<void> {
  let streamError: ProjectIndexWorkerErrorContext | undefined;
  try {
    const parsed = JSON.parse(line) as ProjectIndexWorkerRequest;
    streamError = errorContextForMethod(parsed.method);
    const req = await assembleProjectIndexWorkerRequest(parsed);
    if (!req) {
      return;
    }
    await runAssembledRequest(req, streamError);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[project-indexer] error: ${message}\n`);
    if (streamError?.kind === "phase") {
      await writeProjectIndexPhaseError(
        writeResponse,
        streamError.method,
        streamError.phase,
        message,
      );
    } else if (streamError?.kind === "artifact") {
      await writeProjectIndexArtifactError(
        writeResponse,
        streamError.method,
        streamError.artifact,
        message,
      );
    } else {
      await writeResponse({ error: message });
    }
  }
}

async function runAssembledRequest(
  req: ProjectIndexWorkerRequest,
  streamError: ProjectIndexWorkerErrorContext | undefined,
): Promise<void> {
  try {
    switch (req.method) {
      case "resolveProjectModel": {
        if (!req.root) throw new Error("resolveProjectModel requires root");
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const projectModel = await resolveProjectModel({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          resolutionMode: requestResolutionMode(req.resolutionMode),
        });
        await writeArtifactEvent(
          writeResponse,
          "projectModel",
          projectModel,
          req.root,
        );
        break;
      }
      case "inspectProjectConfig": {
        if (!req.root) throw new Error("inspectProjectConfig requires root");
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const config = await inspectProjectConfig({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          resolutionMode: requestResolutionMode(req.resolutionMode),
        });
        await writeArtifactEvent(
          writeResponse,
          "projectConfig",
          config,
          req.root,
        );
        break;
      }
      case "inspectProjectStaticIndexConfig": {
        if (!req.root)
          throw new Error("inspectProjectStaticIndexConfig requires root");
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const config = await inspectProjectStaticIndexConfig({
          root: req.root,
          configPath: req.configPath,
        });
        await writeArtifactEvent(
          writeResponse,
          "projectStaticIndexConfig",
          config,
          req.root,
        );
        break;
      }
      case "inspectProjectStaticSyntaxPlan": {
        if (!req.root)
          throw new Error("inspectProjectStaticSyntaxPlan requires root");
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const plan = await inspectProjectStaticSyntaxPlan({
          root: req.root,
          configPath: req.configPath,
          projectName: req.projectName,
          resolutionMode: requestResolutionMode(req.resolutionMode),
          includeCacheStatus: req.includeStaticCacheStatus,
        });
        await writeArtifactEvent(
          writeResponse,
          "projectStaticSyntaxPlan",
          plan,
          req.root,
        );
        break;
      }
      case "loadStaticExtensionHostManifest":
      case "extractStaticEvidenceBatch":
      case "checkStaticRules": {
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        await writeStaticHostArtifactRequest(writeResponse, req);
        break;
      }
      case "generateRuntimeArtifacts": {
        if (!req.root)
          throw new Error("generateRuntimeArtifacts requires root");
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const result = await generateRuntimeArtifacts({
          root: req.root,
          definitions: req.definitions,
        });
        await writeArtifactEvent(
          writeResponse,
          "runtimeArtifacts",
          result,
          req.root,
        );
        break;
      }
      case "createDeploymentManifest": {
        await writeDeploymentManifestArtifact(writeResponse, req);
        break;
      }
      case "runRuntimeOperation": {
        if (!req.root) throw new Error("runRuntimeOperation requires root");
        if (!req.runtimeOperation)
          throw new Error("runRuntimeOperation requires runtimeOperation");
        if (!isRuntimeOperationKind(req.runtimeOperation)) {
          throw new Error(`unknown runtime operation: ${req.runtimeOperation}`);
        }
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const result = await runRuntimeOperation({
          root: req.root,
          operation: req.runtimeOperation,
          workId: req.runtimeWorkId,
          includeDetails: req.runtimeIncludeDetails === true,
        });
        await writeArtifactEvent(
          writeResponse,
          "runtimeOperation",
          result,
          req.root,
        );
        break;
      }
      case "runSetupOperation": {
        if (!req.root) throw new Error("runSetupOperation requires root");
        if (req.setupMode !== "check" && req.setupMode !== "apply") {
          throw new Error(
            "runSetupOperation requires setupMode check or apply",
          );
        }
        assertProjectIndexWorkerProtocolV2(req.protocolVersion);
        const report = await runSetupOperation({
          root: req.root,
          mode: req.setupMode,
        });
        await writeArtifactEvent(
          writeResponse,
          "setupOperation",
          report,
          req.root,
        );
        break;
      }
      default:
        await writeResponse({ error: `unknown method: ${req.method}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[project-indexer] error: ${message}\n`);
    if (streamError?.kind === "phase") {
      await writeProjectIndexPhaseError(
        writeResponse,
        streamError.method,
        streamError.phase,
        message,
      );
    } else if (streamError?.kind === "artifact") {
      await writeProjectIndexArtifactError(
        writeResponse,
        streamError.method,
        streamError.artifact,
        message,
      );
    } else {
      await writeResponse({ error: message });
    }
  }
}

function requestResolutionMode(
  value: unknown,
): ProjectModelResolutionMode | undefined {
  return isProjectModelResolutionMode(value) ? value : undefined;
}

rl.on("close", () => {
  closing = true;
  maybeExit();
});
