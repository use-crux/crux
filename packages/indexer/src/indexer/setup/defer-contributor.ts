import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineSetupContributor, type SetupContext, type SetupFinding } from '@use-crux/core/setup'

interface PackageManifest { readonly dependencies?: Readonly<Record<string, string>>; readonly devDependencies?: Readonly<Record<string, string>> }

const docsUrl = 'https://cruxjs.dev/docs/guides/defer/troubleshooting'

async function packages(root: string): Promise<Readonly<Record<string, string>>> {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageManifest
    return { ...manifest.dependencies, ...manifest.devDependencies }
  } catch { return {} }
}

/** Inspect request-scoped defer host and durability readiness. */
export function createDeferSetupContributor(options: { readonly hasRuntime: boolean }) {
  return defineSetupContributor({
    id: 'defer',
    async inspect(project: SetupContext): Promise<readonly SetupFinding[]> {
      const installed = await packages(project.root)
      const findings: SetupFinding[] = []
      if ('next' in installed && !('@use-crux/next' in installed)) {
        findings.push({ contributorId: 'defer', code: 'DEFER_NEXT_INTEGRATION_MISSING', resource: '@use-crux/next', severity: 'error', message: 'Next.js is installed without the Crux response-finished defer integration.', docsUrl, remediation: 'pnpm add @use-crux/next', agentPrompt: 'Install @use-crux/next and wrap the Next handler with its documented response-finished defer integration.' })
      }
      if (!options.hasRuntime) {
        findings.push({ contributorId: 'defer', code: 'DEFER_RUNTIME_NOT_CONFIGURED', resource: 'runtime', severity: 'warning', message: 'Named deferred targets require a configured Runtime Engine; inline callbacks remain available only through an active host lifetime capability.', docsUrl, remediation: 'Configure `runtime` in crux.config.ts before using `defer(target, input)`.', agentPrompt: 'Configure a Crux Runtime Engine in crux.config.ts for durable named defer targets. Do not weaken inline host capability checks.' })
      }
      findings.push({ contributorId: 'defer', code: 'DEFER_HOST_CAPABILITY_RUNTIME_BOUND', resource: 'host-lifetime', severity: 'info', message: 'Inline defer capability is established at the active host boundary and cannot be proven from installed packages alone.', docsUrl, remediation: 'Verify the host wrapper declares response-finished or handler-returned completion semantics.' })
      return findings
    },
    async plan() { return [] },
  })
}
