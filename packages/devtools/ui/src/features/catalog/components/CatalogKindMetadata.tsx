import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Chip, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { SchemaCard, schemaToFields } from '@/features/catalog/components/CatalogSchema'
import type { JsonSchema, ProjectDefinition } from '@/types'

export function KindMetadataBlock({
  def,
  defsById,
  onSelect,
}: {
  def: ProjectDefinition
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
  projectRoot: string | undefined
}) {
  const meta = (def.metadata ?? {}) as Record<string, unknown>
  const kind = def.kind

  if (kind === 'workspace') {
    const namespace = meta.namespace as string | undefined
    const mounts = (meta.mounts as Array<{ path?: string; access?: string; description?: string }> | undefined) ?? []
    const hasTools = meta.hasTools as boolean | undefined
    const hasBlobStorage = meta.hasBlobStorage as boolean | undefined
    if (!namespace && mounts.length === 0 && hasTools == null && hasBlobStorage == null) return null
    return (
      <>
        <SectionHead
          eyebrow="Workspace"
          right={
            mounts.length > 0 ? (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {mounts.length} mount{mounts.length === 1 ? '' : 's'}
              </span>
            ) : undefined
          }
        />
        <div
          className="mb-6 overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {namespace && (
            <MetaRow
              label="namespace"
              value={namespace}
              mono
              last={mounts.length === 0 && hasTools == null && hasBlobStorage == null}
            />
          )}
          {mounts.length > 0 && (
            <div
              style={{
                borderBottom: hasTools != null || hasBlobStorage != null ? '1px solid var(--qw-border)' : 'none',
              }}
            >
              <div
                className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
                style={{
                  gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 2fr)',
                  color: 'var(--qw-fg-faint)',
                  borderBottom: '1px solid var(--qw-border)',
                  background: 'var(--qw-bg-muted)',
                }}
              >
                <div>path</div>
                <div>access</div>
                <div>description</div>
              </div>
              {mounts.map((m, i) => (
                <div
                  key={`${m.path ?? i}`}
                  className="grid items-baseline gap-2.5 px-4 py-2 text-[12px] font-mono"
                  style={{
                    gridTemplateColumns: 'minmax(0, 1.4fr) 90px minmax(0, 2fr)',
                    borderBottom: i === mounts.length - 1 ? 'none' : '1px solid var(--qw-border)',
                  }}
                >
                  <span className="truncate" style={{ color: 'var(--qw-crux)' }} title={m.path ?? '—'}>
                    {m.path ?? '—'}
                  </span>
                  <span className="text-[10.5px] lowercase" style={{ color: 'var(--qw-fg-muted)' }}>
                    {m.access ?? '—'}
                  </span>
                  <span
                    className="truncate text-[11.5px]"
                    style={{
                      color: 'var(--qw-fg-muted)',
                      fontFamily: 'var(--qw-serif, Georgia, serif)',
                    }}
                    title={m.description ?? ''}
                  >
                    {m.description ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(hasTools != null || hasBlobStorage != null) && (
            <div className="flex flex-wrap gap-3 px-4 py-2.5 font-mono text-[11.5px]">
              {hasTools != null && (
                <Chip tone={hasTools ? 'ok' : 'muted'} dot>
                  {hasTools ? 'tools enabled' : 'no tools'}
                </Chip>
              )}
              {hasBlobStorage != null && (
                <Chip tone={hasBlobStorage ? 'ok' : 'muted'} dot>
                  {hasBlobStorage ? 'blob storage' : 'no blob storage'}
                </Chip>
              )}
            </div>
          )}
        </div>
        <WorkspaceIntelligence def={def} />
      </>
    )
  }

  if (kind === 'flow') {
    const runtime = meta.runtime as string | undefined
    const args = (meta.args as string[] | undefined) ?? []
    const stepNames = (meta.stepNames as string[] | undefined) ?? []
    // Prefer relations[] for the actual step list (per backend handoff);
    // fall back to metadata.stepNames as a static signal.
    if (!runtime && args.length === 0 && stepNames.length === 0) return null
    return (
      <>
        <SectionHead
          eyebrow="Flow"
          right={
            <span className="flex items-center gap-1.5">
              {runtime && (
                <Chip tone="crux" mono>
                  runtime · {runtime}
                </Chip>
              )}
              {stepNames.length > 0 && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {stepNames.length} step{stepNames.length === 1 ? '' : 's'}
                </span>
              )}
            </span>
          }
        />
        <div className="mb-6 flex flex-col gap-3">
          {args.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                args
              </span>
              {args.map((a) => (
                <span
                  key={a}
                  className="rounded-[4px] px-1.5 py-[1px] font-mono text-[10.5px]"
                  style={{
                    background: 'var(--qw-iris-soft)',
                    color: 'var(--qw-iris)',
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          )}
          {stepNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {stepNames.map((s, i) => (
                <div
                  key={s}
                  className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 font-mono text-[12px]"
                  style={{
                    background: 'var(--qw-bg-elev)',
                    border: '1px solid var(--qw-border)',
                  }}
                >
                  <span className="text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {i + 1}.
                  </span>
                  <span style={{ color: 'var(--qw-fg)' }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  if (kind === 'flow.step') {
    const flowId = meta.flowId as string | undefined
    if (!flowId) return null
    const parent = defsById.get(flowId)
    return (
      <>
        <SectionHead eyebrow="Flow" />
        <div className="mb-6">
          <button
            type="button"
            onClick={() => parent && onSelect(parent.id)}
            className="flex items-center gap-2 rounded-[6px] px-3 py-2 transition-colors hover:bg-(--qw-bg-muted)"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
            }}
          >
            <Icon name="loop" size={12} color="var(--qw-crux)" />
            <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--qw-crux)' }}>
              {parent?.name ?? flowId}
            </span>
            <Icon name="arrowRight" size={11} color="var(--qw-fg-faint)" />
          </button>
        </div>
      </>
    )
  }

  if (kind === 'agent') {
    const runtime = meta.runtime as string | undefined
    const hasTools = meta.hasTools as boolean | undefined
    const hasContextHandler = meta.hasContextHandler as boolean | undefined
    const hasUsageHandler = meta.hasUsageHandler as boolean | undefined
    const maxSteps = meta.maxSteps as string | number | undefined
    const promptId = meta.promptId as string | undefined
    if (
      !runtime &&
      hasTools == null &&
      hasContextHandler == null &&
      hasUsageHandler == null &&
      maxSteps == null &&
      !promptId
    ) {
      return null
    }
    return (
      <>
        <SectionHead
          eyebrow="Agent"
          right={
            runtime ? (
              <Chip tone="iris" mono>
                runtime · {runtime}
              </Chip>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {hasTools != null && (
            <Chip tone={hasTools ? 'ok' : 'muted'} dot>
              {hasTools ? 'tools' : 'no tools'}
            </Chip>
          )}
          {hasContextHandler != null && (
            <Chip tone={hasContextHandler ? 'ok' : 'muted'} dot>
              {hasContextHandler ? 'context handler' : 'no context handler'}
            </Chip>
          )}
          {hasUsageHandler != null && (
            <Chip tone={hasUsageHandler ? 'ok' : 'muted'} dot>
              {hasUsageHandler ? 'usage handler' : 'no usage handler'}
            </Chip>
          )}
          {maxSteps != null && (
            <Chip tone="muted" mono>
              maxSteps · {String(maxSteps)}
            </Chip>
          )}
          {promptId && (
            <button
              type="button"
              onClick={() => defsById.has(promptId) && onSelect(promptId)}
              className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] font-mono text-[10.5px] transition-opacity hover:opacity-80"
              style={{
                background: 'var(--qw-iris-soft)',
                color: 'var(--qw-iris)',
              }}
            >
              prompt · {promptId.replace(/^prompt:/, '')}
              <Icon name="arrowRight" size={10} color="var(--qw-iris)" />
            </button>
          )}
        </div>
        <AgentDependencyLabels def={def} />
      </>
    )
  }

  if (kind === 'memory') {
    const backend = meta.backend as string | undefined
    const runtimeIdPrefix = meta.runtimeIdPrefix as string | undefined
    const blockCount = meta.blockCount as number | undefined
    const blocks = meta.blocks as Array<{ id?: string; kind?: string; hasEmbed?: boolean }> | undefined
    if (
      !backend &&
      !runtimeIdPrefix &&
      blockCount == null &&
      (!blocks || blocks.length === 0)
    ) {
      return null
    }
    return (
      <>
        <SectionHead
          eyebrow="Memory store"
          right={
            <span className="flex items-center gap-1.5">
              {backend && (
                <Chip tone="ok" mono>
                  {backend}
                </Chip>
              )}
              {blockCount != null && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {blockCount} block{blockCount === 1 ? '' : 's'}
                </span>
              )}
            </span>
          }
        />
        <div
          className="mb-6 overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {runtimeIdPrefix && (
            <MetaRow
              label="runtime id"
              value={
                <>
                  <span style={{ color: 'var(--qw-crux)' }}>{runtimeIdPrefix}</span>
                  <span style={{ color: 'var(--qw-fg-faint)' }}>&lt;id&gt;</span>
                </>
              }
              mono
              last={!blocks || blocks.length === 0}
            />
          )}
          {blocks && blocks.length > 0 && (
            <div>
              <div
                className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
                style={{
                  gridTemplateColumns: 'minmax(0, 1fr) 100px 80px',
                  color: 'var(--qw-fg-faint)',
                  borderBottom: '1px solid var(--qw-border)',
                  background: 'var(--qw-bg-muted)',
                }}
              >
                <div>block</div>
                <div>kind</div>
                <div className="text-right">embed</div>
              </div>
              {blocks.map((b, i) => (
                <div
                  key={`${b.id ?? i}`}
                  className="grid items-baseline gap-2.5 px-4 py-2 font-mono text-[12px]"
                  style={{
                    gridTemplateColumns: 'minmax(0, 1fr) 100px 80px',
                    borderBottom: i === blocks.length - 1 ? 'none' : '1px solid var(--qw-border)',
                  }}
                >
                  <span style={{ color: 'var(--qw-crux)' }}>{b.id ?? '—'}</span>
                  <span style={{ color: 'var(--qw-fg-muted)' }}>{b.kind ?? '—'}</span>
                  <span
                    className="text-right text-[10.5px]"
                    style={{ color: b.hasEmbed ? 'var(--qw-ok)' : 'var(--qw-fg-faint)' }}
                  >
                    {b.hasEmbed ? 'yes' : 'no'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  if (kind === 'memory.block') {
    const memoryId = meta.memoryId as string | undefined
    const blockKind = meta.blockKind as string | undefined
    const hasEmbed = meta.hasEmbed as boolean | undefined
    const writeMode = meta.writeMode as string | undefined
    if (!memoryId && !blockKind && hasEmbed == null && !writeMode) return null
    const parent = memoryId ? defsById.get(memoryId) : undefined
    return (
      <>
        <SectionHead
          eyebrow="Memory block"
          right={
            blockKind ? (
              <Chip tone="iris" mono>
                {blockKind}
              </Chip>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {parent && (
            <button
              type="button"
              onClick={() => onSelect(parent.id)}
              className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[2px] font-mono text-[11px] transition-opacity hover:opacity-80"
              style={{
                background: 'var(--qw-crux-soft)',
                color: 'var(--qw-crux)',
                border: '1px solid var(--qw-crux-line)',
              }}
            >
              <Icon name="brain" size={10} color="var(--qw-crux)" />
              {parent.name}
              <Icon name="arrowRight" size={10} color="var(--qw-crux)" />
            </button>
          )}
          {hasEmbed != null && (
            <Chip tone={hasEmbed ? 'ok' : 'muted'} dot>
              {hasEmbed ? 'vector index' : 'no embedding'}
            </Chip>
          )}
          {writeMode && (
            <Chip tone="muted" mono>
              write · {writeMode}
            </Chip>
          )}
        </div>
      </>
    )
  }

  if (kind === 'memory.store') {
    const backend = meta.backend as string | undefined
    const component = meta.component as string | undefined
    const ownerDefinitionKey = meta.ownerDefinitionKey as string | undefined
    if (!backend && !component && !ownerDefinitionKey) return null
    return (
      <>
        <SectionHead
          eyebrow="Memory store"
          right={
            backend ? (
              <Chip tone="ok" mono>
                {backend}
              </Chip>
            ) : undefined
          }
        />
        <div
          className="mb-6 overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {component && (
            <MetaRow
              label="component"
              value={component}
              mono
              last={!ownerDefinitionKey}
            />
          )}
          {ownerDefinitionKey && (
            <MetaRow label="owner" value={ownerDefinitionKey} mono last />
          )}
        </div>
      </>
    )
  }

  if (kind === 'blackboard') {
    const backend = meta.backend as string | undefined
    const runtimeIdPrefix = meta.runtimeIdPrefix as string | undefined
    if (!backend && !runtimeIdPrefix) return null
    return (
      <>
        <SectionHead
          eyebrow="Blackboard"
          right={
            backend ? (
              <Chip tone="ok" mono>
                {backend}
              </Chip>
            ) : undefined
          }
        />
        <div
          className="mb-6 overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {runtimeIdPrefix && (
            <MetaRow
              label="runtime id"
              value={
                <>
                  <span style={{ color: 'var(--qw-crux)' }}>{runtimeIdPrefix}</span>
                  <span style={{ color: 'var(--qw-fg-faint)' }}>&lt;id&gt;</span>
                </>
              }
              mono
              last
            />
          )}
        </div>
      </>
    )
  }

  if (kind === 'constraint' || kind === 'guardrail') {
    const appliesTo = (meta.appliesTo as string[] | undefined) ?? []
    if (appliesTo.length === 0) return null
    const tone = kind === 'constraint' ? 'warn' : 'ok'
    return (
      <>
        <SectionHead
          eyebrow={`${kind.charAt(0).toUpperCase() + kind.slice(1)} · applies to`}
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {appliesTo.length}
            </span>
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {appliesTo.map((label) => (
            <Chip key={label} tone={tone} mono>
              {label}
            </Chip>
          ))}
        </div>
      </>
    )
  }

  if (kind === 'eval' || kind === 'eval.prompt' || kind === 'eval.flow') {
    const covers = (meta.covers as string[] | undefined) ?? []
    if (covers.length === 0) return null
    return (
      <>
        <SectionHead
          eyebrow="Eval · covers"
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {covers.length}
            </span>
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {covers.map((label) => (
            <Chip key={label} tone="crux" mono>
              {label}
            </Chip>
          ))}
        </div>
      </>
    )
  }

  if (kind === 'composition.pipeline.stage') {
    const targetProperty = meta.targetProperty as string | undefined
    if (!targetProperty) return null
    return (
      <>
        <SectionHead
          eyebrow="Pipeline stage"
          right={
            <Chip tone="iris" mono>
              targets · {targetProperty}
            </Chip>
          }
        />
        <div className="mb-6" />
      </>
    )
  }

  if (kind === 'composition.consensus') {
    const judgeId = meta.judge as string | undefined
    const scorerId = meta.scorer as string | undefined
    if (!judgeId && !scorerId) return null
    return (
      <>
        <SectionHead eyebrow="Consensus" />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {judgeId && <RefChip label="judge" id={judgeId} defsById={defsById} onSelect={onSelect} />}
          {scorerId && <RefChip label="scorer" id={scorerId} defsById={defsById} onSelect={onSelect} />}
        </div>
      </>
    )
  }

  if (kind === 'composition.swarm') {
    const sharedBlackboardId = meta.sharedBlackboard as string | undefined
    const sharedMemoryId = meta.sharedMemory as string | undefined
    if (!sharedBlackboardId && !sharedMemoryId) return null
    return (
      <>
        <SectionHead eyebrow="Swarm · shared state" />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {sharedBlackboardId && (
            <RefChip
              label="blackboard"
              id={sharedBlackboardId}
              defsById={defsById}
              onSelect={onSelect}
            />
          )}
          {sharedMemoryId && (
            <RefChip
              label="memory"
              id={sharedMemoryId}
              defsById={defsById}
              onSelect={onSelect}
            />
          )}
        </div>
      </>
    )
  }

  if (kind === 'routing.router') {
    const routeKeys = (meta.routeKeys as string[] | undefined) ?? []
    const routeCount = (meta.routeCount as number | undefined) ?? routeKeys.length
    const hasDefaultRoute = meta.hasDefaultRoute as boolean | undefined
    const hasClassify = meta.hasClassify as boolean | undefined
    const hasStableId = meta.hasStableId as boolean | undefined
    if (routeKeys.length === 0 && hasDefaultRoute == null && hasClassify == null) return null
    return (
      <>
        <SectionHead
          eyebrow="Router"
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {routeCount} route{routeCount === 1 ? '' : 's'}
            </span>
          }
        />
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {hasClassify != null && (
              <Chip tone={hasClassify ? 'ok' : 'muted'} dot>
                {hasClassify ? 'classify' : 'no classify'}
              </Chip>
            )}
            {hasDefaultRoute != null && (
              <Chip tone={hasDefaultRoute ? 'ok' : 'warn'} dot>
                {hasDefaultRoute ? 'default route' : 'no default route'}
              </Chip>
            )}
            {hasStableId === false && (
              <Chip tone="warn" dot>
                unstable id
              </Chip>
            )}
          </div>
          {routeKeys.length > 0 && <LabelList eyebrow="routes" items={routeKeys} tone="crux" />}
        </div>
      </>
    )
  }

  if (kind === 'routing.router.route') {
    const routerId = meta.routerDefinitionId as string | undefined
    const routeKey = meta.routeKey as string | undefined
    const isDefault = meta.isDefault as boolean | undefined
    if (!routerId && !routeKey && isDefault == null && !meta.targetDefinitionId && !meta.targetVariable) return null
    return (
      <>
        <SectionHead
          eyebrow="Route"
          right={
            routeKey ? (
              <Chip tone="crux" mono>
                {routeKey}
              </Chip>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {routerId && <RefChip label="router" id={routerId} defsById={defsById} onSelect={onSelect} />}
          {isDefault && (
            <Chip tone="ok" dot>
              default
            </Chip>
          )}
          <RoutingTarget meta={meta} defsById={defsById} onSelect={onSelect} />
        </div>
      </>
    )
  }

  if (kind === 'routing.cascade') {
    const tierCount = (meta.tierCount as number | undefined) ?? 0
    const hasBudget = meta.hasBudget as boolean | undefined
    const budgetText = budgetLabel(meta.budget)
    const hasStableId = meta.hasStableId as boolean | undefined
    if (!tierCount && hasBudget == null && budgetText == null) return null
    return (
      <>
        <SectionHead
          eyebrow="Cascade"
          right={
            tierCount > 0 ? (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {tierCount} tier{tierCount === 1 ? '' : 's'}
              </span>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {budgetText != null ? (
            <Chip tone="iris" mono>
              budget · {budgetText}
            </Chip>
          ) : hasBudget != null ? (
            <Chip tone={hasBudget ? 'iris' : 'muted'} dot>
              {hasBudget ? 'budget' : 'no budget'}
            </Chip>
          ) : null}
          {hasStableId === false && (
            <Chip tone="warn" dot>
              unstable id
            </Chip>
          )}
        </div>
      </>
    )
  }

  if (kind === 'routing.cascade.tier') {
    const cascadeId = meta.cascadeDefinitionId as string | undefined
    const tierIndex = meta.tierIndex as number | undefined
    const hasEvaluate = meta.hasEvaluate as boolean | undefined
    const budgetText = budgetLabel(meta.budget)
    const note = meta.note as string | undefined
    if (
      !cascadeId &&
      tierIndex == null &&
      hasEvaluate == null &&
      budgetText == null &&
      !note &&
      !meta.targetDefinitionId &&
      !meta.targetVariable
    ) {
      return null
    }
    return (
      <>
        <SectionHead
          eyebrow="Cascade tier"
          right={
            tierIndex != null ? (
              <Chip tone="crux" mono>
                Tier {tierIndex + 1}
              </Chip>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {cascadeId && <RefChip label="cascade" id={cascadeId} defsById={defsById} onSelect={onSelect} />}
            {hasEvaluate != null && (
              <Chip tone={hasEvaluate ? 'ok' : 'warn'} dot>
                {hasEvaluate ? 'evaluator' : 'no evaluator'}
              </Chip>
            )}
            {budgetText != null && (
              <Chip tone="iris" mono>
                budget · {budgetText}
              </Chip>
            )}
            <RoutingTarget meta={meta} defsById={defsById} onSelect={onSelect} />
          </div>
          {note && (
            <span className="text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {note}
            </span>
          )}
        </div>
      </>
    )
  }

  if (kind === 'routing.fallback') {
    const optionCount = (meta.optionCount as number | undefined) ?? 0
    const timeout = meta.timeout as string | number | undefined
    const policy = meta.policy as string | undefined
    const hasStableId = meta.hasStableId as boolean | undefined
    if (!optionCount && timeout == null && !policy) return null
    return (
      <>
        <SectionHead
          eyebrow="Fallback"
          right={
            optionCount > 0 ? (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {optionCount} option{optionCount === 1 ? '' : 's'}
              </span>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {policy && (
            <Chip tone="iris" mono>
              policy · {policy}
            </Chip>
          )}
          {timeout != null && (
            <Chip tone="muted" mono>
              timeout · {String(timeout)}
            </Chip>
          )}
          {hasStableId === false && (
            <Chip tone="warn" dot>
              unstable id
            </Chip>
          )}
        </div>
      </>
    )
  }

  if (kind === 'routing.fallback.option') {
    const fallbackId = meta.fallbackDefinitionId as string | undefined
    const optionIndex = meta.optionIndex as number | undefined
    if (!fallbackId && optionIndex == null && !meta.targetDefinitionId && !meta.targetVariable) return null
    return (
      <>
        <SectionHead
          eyebrow="Fallback option"
          right={
            optionIndex != null ? (
              <Chip tone="crux" mono>
                Attempt {optionIndex + 1}
              </Chip>
            ) : undefined
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {fallbackId && <RefChip label="fallback" id={fallbackId} defsById={defsById} onSelect={onSelect} />}
          <RoutingTarget meta={meta} defsById={defsById} onSelect={onSelect} />
        </div>
      </>
    )
  }

  return null
}

// ─── Routing target chip ────────────────────────────────────────────
// Routes, cascade tiers, and fallback options point at another primitive
// (router/cascade/fallback/agent/prompt). When the semantic pass resolved
// the target statically, metadata carries `targetDefinitionId` (+ optional
// `targetKind`) and we render a linked chip. When it could not be proven
// statically, only `targetVariable` is present — render it as
// unresolved/dynamic, NOT an error (per backend routing handoff).
function RoutingTarget({
  meta,
  defsById,
  onSelect,
}: {
  meta: Record<string, unknown>
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
}) {
  const targetDefinitionId = meta.targetDefinitionId as string | undefined
  const targetKind = meta.targetKind as string | undefined
  const targetVariable = meta.targetVariable as string | undefined
  if (targetDefinitionId && defsById.has(targetDefinitionId)) {
    return <RefChip label={targetKind ?? 'target'} id={targetDefinitionId} defsById={defsById} onSelect={onSelect} />
  }
  if (!targetVariable && !targetDefinitionId) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[2px] font-mono text-[11px]"
      style={{
        background: 'var(--qw-bg-muted)',
        color: 'var(--qw-fg-muted)',
        border: '1px dashed var(--qw-border)',
      }}
      title="Target could not be resolved statically — dynamic at runtime"
    >
      <span className="text-[9px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {targetKind ?? 'target'}
      </span>
      <span>{targetVariable ?? targetDefinitionId}</span>
      <span className="text-[9px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
        unresolved
      </span>
    </span>
  )
}

// Budgets are authored as objects (e.g. `{ maxCost: 0.02, maxTokens: 4000 }`)
// but may also arrive as a bare number/string. Render objects as readable
// `key value` pairs instead of `[object Object]`.
function budgetLabel(budget: unknown): string | null {
  if (budget == null) return null
  if (typeof budget === 'number' || typeof budget === 'string') return String(budget)
  if (typeof budget === 'object') {
    const parts = Object.entries(budget as Record<string, unknown>)
      .filter(([, v]) => v != null && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'))
      .map(([k, v]) => `${k} ${String(v)}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  return null
}

function RefChip({
  label,
  id,
  defsById,
  onSelect,
}: {
  label: string
  id: string
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
}) {
  const def = defsById.get(id)
  const exists = Boolean(def)
  const displayName = def?.name ?? id.replace(/^[^:]+:/, '')
  return (
    <button
      type="button"
      onClick={() => exists && onSelect(id)}
      disabled={!exists}
      className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[2px] font-mono text-[11px] transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60"
      style={{
        background: 'var(--qw-iris-soft)',
        color: 'var(--qw-iris)',
        border: '1px solid var(--qw-iris-soft)',
      }}
      title={id}
    >
      <span
        className="text-[9px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {label}
      </span>
      <span>{displayName}</span>
      {exists && <Icon name="arrowRight" size={10} color="var(--qw-iris)" />}
    </button>
  )
}

// ─── Agent dependency labels (source-level, not canonical edges) ────
// Renders `metadata.intelligence.dependencies.{prompt, tools, handoffs}`
// as small label chips for context. Canonical edges live in
// `relations[]` (agent.uses_prompt / agent.uses_tool / etc) and render
// separately in the Relations section.

function AgentDependencyLabels({ def }: { def: ProjectDefinition }) {
  const meta = (def.metadata ?? {}) as Record<string, unknown>
  const intel = (meta.intelligence as
    | { dependencies?: { prompt?: string; tools?: readonly string[]; handoffs?: readonly string[] } }
    | undefined)?.dependencies
  if (!intel) return null
  const tools = intel.tools ?? []
  const handoffs = intel.handoffs ?? []
  if (tools.length === 0 && handoffs.length === 0) return null
  return (
    <div className="mb-6 flex flex-col gap-2">
      {tools.length > 0 && (
        <LabelList eyebrow="tools" items={tools} tone="ok" />
      )}
      {handoffs.length > 0 && (
        <LabelList eyebrow="handoffs" items={handoffs} tone="iris" />
      )}
    </div>
  )
}

function LabelList({
  eyebrow,
  items,
  tone,
}: {
  eyebrow: string
  items: readonly string[]
  tone: 'ok' | 'iris' | 'crux' | 'warn' | 'muted'
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="font-mono text-[10px] uppercase tracking-[0.1em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {eyebrow}
      </span>
      {items.map((label) => (
        <Chip key={label} tone={tone} mono>
          {label}
        </Chip>
      ))}
    </div>
  )
}

// ─── Workspace intelligence (tools + artifacts) ─────────────────────
// Renders the source-level view authored at the call site:
// `metadata.toolRefs[]` (variable names the user wrote for tools) and
// `metadata.intelligence.data.artifacts[]` (named output artifacts).

function WorkspaceIntelligence({ def }: { def: ProjectDefinition }) {
  const meta = (def.metadata ?? {}) as Record<string, unknown>
  const toolRefs = (meta.toolRefs as string[] | undefined) ?? []
  const intel = meta.intelligence as
    | { tools?: readonly string[]; data?: { artifacts?: ReadonlyArray<{ name: string; kind?: string }> } }
    | undefined
  const toolLabels = intel?.tools ?? toolRefs
  const artifacts = intel?.data?.artifacts ?? []
  if (toolLabels.length === 0 && artifacts.length === 0) return null
  return (
    <div className="mb-6 flex flex-col gap-3">
      {toolLabels.length > 0 && (
        <LabelList eyebrow="tool refs" items={toolLabels} tone="ok" />
      )}
      {artifacts.length > 0 && (
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          <div
            className="flex items-center gap-2 px-3.5 py-2.5"
            style={{
              borderBottom: '1px solid var(--qw-border)',
              background: 'var(--qw-bg-muted)',
            }}
          >
            <Icon name="folder" size={12} color="var(--qw-fg-muted)" />
            <span className="text-[12px] font-semibold">Artifacts</span>
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              {artifacts.length}
            </span>
          </div>
          <div
            className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
            style={{
              gridTemplateColumns: 'minmax(0, 1fr) 100px',
              color: 'var(--qw-fg-faint)',
              borderBottom: '1px solid var(--qw-border)',
            }}
          >
            <div>name</div>
            <div>kind</div>
          </div>
          {artifacts.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="grid items-baseline gap-2.5 px-4 py-2 font-mono text-[11.5px]"
              style={{
                gridTemplateColumns: 'minmax(0, 1fr) 100px',
                borderBottom: i === artifacts.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <span className="truncate" style={{ color: 'var(--qw-crux)' }} title={a.name}>
                {a.name}
              </span>
              <span style={{ color: 'var(--qw-fg-muted)' }}>{a.kind ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetaRow({
  label,
  value,
  mono = false,
  last = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  last?: boolean
}) {
  return (
    <div
      className="grid items-baseline gap-3 px-4 py-2 text-[12px]"
      style={{
        gridTemplateColumns: '120px minmax(0, 1fr)',
        borderBottom: last ? 'none' : '1px solid var(--qw-border)',
      }}
    >
      <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {label}
      </span>
      <span className={cn('truncate', mono && 'font-mono')} style={{ color: 'var(--qw-fg)' }}>
        {value}
      </span>
    </div>
  )
}

// ─── Intelligence block ─────────────────────────────────────────────
// Renders `definition.metadata.intelligence` — backend-projected
// structure/control facts: confidence, control.mode/ordering,
// suspension points, args schema. Only renders when intelligence is
// actually present (missing = "not statically knowable yet").

interface SuspensionPoint {
  id?: string
  label?: string
  signal?: string
}

interface DataAccessEntry {
  targetVariable?: string
  key?: string
}

interface IntelligenceMeta {
  confidence?: 'static' | string
  contract?: {
    argsSchema?: JsonSchema
    [k: string]: unknown
  }
  control?: {
    mode?: 'immediate' | 'durable' | 'parallel' | 'sequential' | 'consensus' | 'swarm' | string
    ordering?: 'ordered' | 'concurrent' | 'event-driven' | string
    /** Items may be a string OR an object `{ id, label, signal }`. */
    suspensionPoints?: ReadonlyArray<string | SuspensionPoint>
    [k: string]: unknown
  }
  /** Static data-access summary projected onto flow.step definitions when
   * the source directly calls memory / blackboard / workspace APIs in
   * the step callback. Canonical edge targets come from `relations[]`
   * (`flow.step.{reads,writes}_{memory,blackboard,workspace}`); these
   * entries are descriptive context — the variable name the user wrote
   * and the key being accessed. */
  data?: {
    reads?: ReadonlyArray<DataAccessEntry>
    writes?: ReadonlyArray<DataAccessEntry>
    [k: string]: unknown
  }
  [k: string]: unknown
}

function suspensionPointLabel(p: string | SuspensionPoint): string {
  if (typeof p === 'string') return p
  return p.label ?? p.signal ?? p.id ?? 'wait'
}

function suspensionPointKey(p: string | SuspensionPoint, i: number): string {
  if (typeof p === 'string') return p
  return p.id ?? p.signal ?? p.label ?? `wait-${i}`
}

function suspensionPointTooltip(p: string | SuspensionPoint): string | undefined {
  if (typeof p === 'string') return p
  const parts: string[] = []
  if (p.label) parts.push(p.label)
  if (p.signal && p.signal !== p.label) parts.push(`signal: ${p.signal}`)
  if (p.id && p.id !== p.label && p.id !== p.signal) parts.push(`id: ${p.id}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function IntelligenceBlock({ def }: { def: ProjectDefinition }) {
  const intel = (def.metadata as { intelligence?: IntelligenceMeta } | undefined)?.intelligence
  if (!intel) return null

  const control = intel.control
  const contract = intel.contract
  const data = intel.data
  const mode = control?.mode
  const ordering = control?.ordering
  const suspensionPoints: ReadonlyArray<string | SuspensionPoint> = Array.isArray(control?.suspensionPoints)
    ? control.suspensionPoints
    : []
  const argsSchema = contract?.argsSchema
  const argsFields = argsSchema ? schemaToFields(argsSchema) : []
  const reads: ReadonlyArray<DataAccessEntry> = Array.isArray(data?.reads) ? data.reads : []
  const writes: ReadonlyArray<DataAccessEntry> = Array.isArray(data?.writes) ? data.writes : []

  const hasControlRow = Boolean(mode || ordering)
  const hasSuspension = suspensionPoints.length > 0
  const hasArgs = argsFields.length > 0
  const hasData = reads.length > 0 || writes.length > 0
  const hasAny =
    hasControlRow || hasSuspension || hasArgs || hasData || Boolean(intel.confidence)
  if (!hasAny) return null

  // Eyebrow follows what's actually present so the label is honest.
  // Pure data-access intelligence (agents/tools that only read/write
  // memory/blackboard/workspace) shouldn't be labelled as "control".
  const hasControlShape = hasControlRow || hasSuspension || hasArgs
  const eyebrow =
    hasControlShape && hasData
      ? 'Intelligence'
      : hasControlShape
        ? 'Structure · control'
        : hasData
          ? 'Data access'
          : 'Intelligence'

  return (
    <>
      <SectionHead
        eyebrow={eyebrow}
        right={
          intel.confidence ? (
            <Chip tone="muted" mono>
              {intel.confidence}
            </Chip>
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-col gap-3">
        {hasControlRow && (
          <div className="flex flex-wrap items-center gap-1.5">
            {mode && (
              <Chip tone={modeTone(mode)} mono>
                mode · {mode}
              </Chip>
            )}
            {ordering && (
              <Chip tone="muted" mono>
                {ordering}
              </Chip>
            )}
          </div>
        )}
        {hasSuspension && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.1em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              suspends on
            </span>
            {suspensionPoints.map((p, i) => (
              <span
                key={suspensionPointKey(p, i)}
                className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] font-mono text-[10.5px]"
                style={{
                  background: 'var(--qw-warn-soft)',
                  color: 'var(--qw-warn)',
                }}
                title={suspensionPointTooltip(p)}
              >
                <Icon name="clock" size={10} color="var(--qw-warn)" />
                {suspensionPointLabel(p)}
              </span>
            ))}
          </div>
        )}
        {hasArgs && (
          <SchemaCard
            title="Args schema"
            dotColor="var(--qw-iris)"
            fields={argsFields}
          />
        )}
        {hasData && <DataAccessTable reads={reads} writes={writes} />}
      </div>
    </>
  )
}

function DataAccessTable({
  reads,
  writes,
}: {
  reads: ReadonlyArray<DataAccessEntry>
  writes: ReadonlyArray<DataAccessEntry>
}) {
  // Combined rows so reads + writes share one table; op chip distinguishes.
  // Canonical target ids come from `relations[]` (rendered in the
  // Relations section); these rows show the variable name + key the user
  // wrote inside the flow.step callback.
  type Row = DataAccessEntry & { op: 'read' | 'write' }
  const rows: Row[] = [
    ...reads.map((r) => ({ ...r, op: 'read' as const })),
    ...writes.map((w) => ({ ...w, op: 'write' as const })),
  ]
  const hasKey = rows.some((r) => r.key)
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg-muted)',
        }}
      >
        <Icon name="diff" size={12} color="var(--qw-fg-muted)" />
        <span className="text-[12px] font-semibold">Data access</span>
        <span
          className="ml-auto font-mono text-[11px]"
          style={{ color: 'var(--qw-fg-faint)' }}
        >
          {reads.length} read{reads.length === 1 ? '' : 's'} · {writes.length} write
          {writes.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
        style={{
          gridTemplateColumns: hasKey
            ? '70px minmax(0, 1fr) minmax(0, 1fr)'
            : '70px minmax(0, 1fr)',
          color: 'var(--qw-fg-faint)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <div>op</div>
        <div>target</div>
        {hasKey && <div>key</div>}
      </div>
      {rows.map((r, i) => (
        <div
          key={`${r.op}-${r.targetVariable ?? ''}-${r.key ?? ''}-${i}`}
          className="grid items-baseline gap-2.5 px-4 py-2 font-mono text-[11.5px]"
          style={{
            gridTemplateColumns: hasKey
              ? '70px minmax(0, 1fr) minmax(0, 1fr)'
              : '70px minmax(0, 1fr)',
            borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--qw-border)',
          }}
        >
          <Chip
            tone={r.op === 'write' ? 'danger' : 'ok'}
            mono
            className="w-fit"
          >
            {r.op}
          </Chip>
          <span
            className="truncate"
            style={{ color: r.targetVariable ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
            title={r.targetVariable ?? ''}
          >
            {r.targetVariable ?? '—'}
          </span>
          {hasKey && (
            <span
              className="truncate"
              style={{ color: 'var(--qw-fg)' }}
              title={r.key ?? ''}
            >
              {r.key ?? '—'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function modeTone(mode: string): 'crux' | 'iris' | 'ok' | 'warn' | 'muted' {
  switch (mode) {
    case 'durable':
      return 'crux'
    case 'parallel':
    case 'swarm':
      return 'iris'
    case 'routing':
    case 'cascade':
    case 'fallback':
      return 'crux'
    case 'consensus':
      return 'ok'
    case 'immediate':
    case 'sequential':
      return 'muted'
    default:
      return 'muted'
  }
}
