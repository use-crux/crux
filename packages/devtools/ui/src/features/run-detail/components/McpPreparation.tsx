import type { McpPreparationView, McpToolOriginView } from '../lib/mcp'
import type { ObservabilityRunDetailNode } from '@/types'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useProjectDefinitionIds } from '@/shared/query/useProjectDefinitionIds'
import { mcpPreparationForRun } from '../lib/mcp'
import { CardShell, KeyValue } from './SpanDetailPanelAtoms'

interface CatalogReferenceProps {
  readonly value: string
  readonly resolved: boolean
  readonly onOpenCatalog?: (definitionId: string) => void
}

function CatalogReference({ value, resolved, onOpenCatalog }: CatalogReferenceProps) {
  if (!resolved || !onOpenCatalog) {
    return <span className="font-mono text-[11px]">{value}</span>
  }
  return (
    <button
      type="button"
      className="font-mono text-[11px] underline underline-offset-2"
      onClick={() => onOpenCatalog(value)}
    >
      {value}
    </button>
  )
}

/** Render one canonical MCP connection or discovery preparation span. */
export function McpPreparation({
  view,
  onOpenCatalog,
}: {
  readonly view: McpPreparationView
  readonly onOpenCatalog?: (definitionId: string) => void
}) {
  const title = view.phase === 'connect' ? 'MCP connection' : 'MCP discovery'
  return (
    <section aria-label={`${title} preparation`} className="flex flex-col gap-3">
      <CardShell label={title}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3.5 py-3">
          <KeyValue k="status" v={view.status} />
          <KeyValue k="duration" v={`${view.durationMs.toLocaleString()}ms`} />
          {view.sourceId && <KeyValue k="server" v={view.sourceId} />}
          {view.transportKind && <KeyValue k="transport" v={view.transportKind} />}
          {view.implementation && <KeyValue k="materializer" v={view.implementation} />}
          {view.protocolVersion && <KeyValue k="protocol" v={view.protocolVersion} />}
          {view.serverVersion && <KeyValue k="server version" v={view.serverVersion} />}
          {view.serverName && <KeyValue k="server name" v={view.serverName} />}
          {view.discoveredToolCount != null && <KeyValue k="Discovered" v={String(view.discoveredToolCount)} />}
          {view.exposedToolCount != null && <KeyValue k="Exposed" v={String(view.exposedToolCount)} />}
          {view.failurePhase && <KeyValue k="failure phase" v={view.failurePhase} />}
          {view.errorCategory && <KeyValue k="error category" v={view.errorCategory} />}
        </div>
      </CardShell>

      {view.server && (
        <CardShell label="Catalog">
          <div className="px-3.5 py-3">
            <CatalogReference value={view.server.value} resolved={view.server.resolved} onOpenCatalog={onOpenCatalog} />
          </div>
        </CardShell>
      )}

      {view.toolListFingerprint && (
        <CardShell label="Discovery identity">
          <div className="px-3.5 py-3">
            <KeyValue k="tool list" v={view.toolListFingerprint} />
          </div>
        </CardShell>
      )}
    </section>
  )
}

/** Render MCP provenance alongside the existing ordinary tool-call body. */
export function McpToolOrigin({
  origin,
  onOpenCatalog,
  onSelectSpan,
}: {
  readonly origin: McpToolOriginView
  readonly onOpenCatalog?: (definitionId: string) => void
  readonly onSelectSpan?: (spanId: string) => void
}) {
  return (
    <CardShell label="MCP origin">
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <span
          className="w-fit rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold"
          style={{
            color: 'var(--qw-crux)',
            background: 'var(--qw-crux-soft)',
          }}
        >
          MCP
        </span>
        {origin.remoteName && <KeyValue k="remote" v={origin.remoteName} />}
        {origin.exposedName && <KeyValue k="exposed" v={origin.exposedName} />}
        {origin.discoverSpanId && (
          <button
            type="button"
            className="w-fit font-mono text-[11px] underline underline-offset-2"
            onClick={() => onSelectSpan?.(origin.discoverSpanId!)}
          >
            Preparation {origin.discoverSpanId}
          </button>
        )}
        {origin.server && (
          <CatalogReference
            value={origin.server.value}
            resolved={origin.server.resolved}
            onOpenCatalog={onOpenCatalog}
          />
        )}
        {origin.tool && (
          <CatalogReference value={origin.tool.value} resolved={origin.tool.resolved} onOpenCatalog={onOpenCatalog} />
        )}
      </div>
    </CardShell>
  )
}

/** Connected preparation card for a selected canonical Run Detail node. */
export function McpPreparationNode({ node }: { readonly node: ObservabilityRunDetailNode }) {
  const knownDefinitionIds = useProjectDefinitionIds()
  const { navigate } = useNavigation()
  const [view] = mcpPreparationForRun(node, knownDefinitionIds)
  if (!view) return null
  return (
    <McpPreparation
      view={view}
      onOpenCatalog={(definitionId) => navigate({ view: 'library-index', promptId: definitionId })}
    />
  )
}
