import { describe, expect, it } from 'vitest'
import { writeStaticHostArtifactRequest } from '../bin/project-indexer-static-host'
import type { ProjectIndexWorkerRequest } from './project-indexer-request'

describe('project index Static Index host protocol', () => {
  it('rejects mismatched compiler protocol versions', async () => {
    const request = {
      method: 'loadStaticExtensionHostManifest',
      protocolVersion: 3,
      nativeCompilerProtocolVersion: 1,
      root: '/repo',
    } as unknown as ProjectIndexWorkerRequest

    await expect(writeStaticHostArtifactRequest(async () => {}, request)).rejects.toThrow(
      'loadStaticExtensionHostManifest requires nativeCompilerProtocolVersion 2',
    )
  })
})
