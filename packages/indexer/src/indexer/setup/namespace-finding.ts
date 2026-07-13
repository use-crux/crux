import type { SetupFinding } from '@use-crux/core/setup'
import type { RuntimeEngineDefinition } from '@use-crux/core/runtime'

const DOCS_URL = 'https://cruxjs.dev/docs/errors/NAMESPACE_AMBIGUOUS'

/** Return the non-failing setup warning for a fallback serverless namespace. */
export function namespaceFallbackFinding(
  runtime: RuntimeEngineDefinition,
): SetupFinding | undefined {
  if (runtime.kind !== 'in-process') return undefined
  if (runtime.namespaceSource !== 'fallback') return undefined

  return Object.freeze({
    contributorId: 'runtime',
    code: 'NAMESPACE_AMBIGUOUS',
    resource: runtime.id,
    severity: 'warning',
    message:
      'Namespace resolved to local by fallback; production deploys of this configuration will fail with NAMESPACE_AMBIGUOUS.',
    docsUrl: DOCS_URL,
    remediation:
      'Set CRUX_RUNTIME_NAMESPACE or pass namespace to the runtime composer.',
    agentPrompt:
      'Configure a production Runtime Engine namespace by setting CRUX_RUNTIME_NAMESPACE or passing namespace to the runtime composer.',
  })
}
