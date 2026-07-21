import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface ArtifactDoneEvent {
  readonly type: 'artifact:done'
  readonly artifact: 'deploymentManifest'
  readonly payload: {
    readonly provenance: {
      readonly producerVersion: string
    }
  }
}

const PACKAGE_ROOT = resolve(__dirname, '..')
const BUILT_WORKER = resolve(PACKAGE_ROOT, 'dist/project-indexer.mjs')

describe('built project-indexer provenance', () => {
  it('uses the version from the indexer package manifest', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, '../indexer/package.json'), 'utf8'),
    ) as { readonly version: string }

    const event = await runBuiltWorker({
      method: 'createDeploymentManifest',
      protocolVersion: 3,
      root: PACKAGE_ROOT,
      projectId: 'producer-version-fixture',
      definitions: [],
      relations: [],
      staticFrontend: 'typescript',
      semanticStatus: 'disabled',
    })

    expect(event.payload.provenance.producerVersion).toBe(packageJson.version)
  }, 30_000)
})

function runBuiltWorker(request: unknown): Promise<ArtifactDoneEvent> {
  return new Promise((resolveEvent, rejectEvent) => {
    const child = spawn(process.execPath, [BUILT_WORKER], {
      cwd: PACKAGE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectEvent)
    child.on('close', (code) => {
      if (code !== 0) {
        rejectEvent(
          new Error(`project-indexer exited with ${code}: ${stderr.trim()}`),
        )
        return
      }
      const event = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Partial<ArtifactDoneEvent>)
        .find(
          (candidate) =>
            candidate.type === 'artifact:done' &&
            candidate.artifact === 'deploymentManifest',
        )
      if (!event?.payload) {
        rejectEvent(
          new Error(`deployment manifest artifact was not emitted: ${stderr}`),
        )
        return
      }
      resolveEvent(event as ArtifactDoneEvent)
    })

    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}
