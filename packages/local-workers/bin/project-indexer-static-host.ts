import {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  loadStaticExtensionHostManifestForProject,
} from '@use-crux/indexer/host/static-compat'
import { isProjectModelResolutionMode } from '@use-crux/core/project-index'
import type { ProjectIndexWorkerRequest } from '../lib/project-indexer-request'
import { writeArtifactEvent, type ProjectIndexWorkerWriter } from './project-indexer-protocol'

/**
 * Writes TypeScript compatibility-host artifacts for Static Index compilation.
 *
 * Go sends native evidence jobs or finalized graph facts as JSON; this worker
 * loads the trusted project extension runtime and returns grouped facts.
 */
export async function writeStaticHostArtifactRequest(
  write: ProjectIndexWorkerWriter,
  req: ProjectIndexWorkerRequest,
): Promise<void> {
  if (!req.root) throw new Error(`${req.method ?? 'static host'} requires root`)
  switch (req.method) {
    case 'loadStaticExtensionHostManifest': {
      const result = await loadStaticExtensionHostManifestForProject({
        root: req.root,
        configPath: req.configPath,
        nativeCompilerProtocolVersion: requiredNativeCompilerProtocolVersion(req.nativeCompilerProtocolVersion),
      })
      await writeArtifactEvent(write, 'staticExtensionHostManifest', result, req.root)
      return
    }
    case 'extractStaticEvidenceBatch': {
      const result = await extractStaticEvidenceBatchForProject({
        root: req.root,
        configPath: req.configPath,
        resolutionMode: requestResolutionMode(req.resolutionMode),
        jobs: req.jobs ?? [],
      })
      await writeArtifactEvent(write, 'staticExtensionEvidenceBatch', result, req.root)
      return
    }
    case 'checkStaticRules': {
      if (!req.graph) throw new Error('checkStaticRules requires graph')
      const result = await checkStaticRulesForProject({
        root: req.root,
        configPath: req.configPath,
        resolutionMode: requestResolutionMode(req.resolutionMode),
        graph: req.graph,
        ...(req.availableFacts ? { availableFacts: req.availableFacts } : {}),
        ...(req.files ? { files: req.files } : {}),
        ...(req.nativeLintFinalize ? { nativeLintFinalize: true } : {}),
      })
      await writeArtifactEvent(write, 'staticRuleCheck', result, req.root)
      return
    }
    default:
      throw new Error(`unknown static host method: ${req.method ?? '<missing>'}`)
  }
}

function requestResolutionMode(value: unknown) {
  return isProjectModelResolutionMode(value) ? value : undefined
}

function requiredNativeCompilerProtocolVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('loadStaticExtensionHostManifest requires nativeCompilerProtocolVersion')
  }
  return value
}
