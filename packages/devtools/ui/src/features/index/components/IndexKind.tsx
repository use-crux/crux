import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import type { ChipTone } from '@/qw/shell/primitives'

interface KindGlyph {
  icon: IconName
  tone: ChipTone
  color: string
  label: string
}

const KIND_GLYPH: Record<string, KindGlyph> = {
  prompt: { icon: 'doc', tone: 'iris', color: 'var(--qw-iris)', label: 'prompt' },
  context: { icon: 'layers', tone: 'warn', color: 'var(--qw-warn)', label: 'context' },
  tool: { icon: 'flask', tone: 'ok', color: 'var(--qw-ok)', label: 'tool' },
  eval: { icon: 'sparkle', tone: 'crux', color: 'var(--qw-crux)', label: 'eval' },
  'eval.prompt': { icon: 'sparkle', tone: 'crux', color: 'var(--qw-crux)', label: 'prompt eval' },
  'eval.flow': { icon: 'sparkle', tone: 'crux', color: 'var(--qw-crux)', label: 'flow eval' },
  'eval.rag': { icon: 'sparkle', tone: 'crux', color: 'var(--qw-crux)', label: 'rag eval' },
  suite: { icon: 'layers', tone: 'muted', color: 'var(--qw-fg-muted)', label: 'suite' },
  memory: { icon: 'brain', tone: 'crux', color: 'var(--qw-crux)', label: 'memory' },
  'memory.block': { icon: 'layers', tone: 'crux', color: 'var(--qw-crux)', label: 'memory block' },
  'memory.store': { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'memory store' },
  working: { icon: 'brain', tone: 'crux', color: 'var(--qw-crux)', label: 'working' },
  blackboard: { icon: 'grid', tone: 'warn', color: 'var(--qw-warn)', label: 'blackboard' },
  episodes: { icon: 'book', tone: 'iris', color: 'var(--qw-iris)', label: 'episodes' },
  facts: { icon: 'list', tone: 'iris', color: 'var(--qw-iris)', label: 'facts' },
  procedures: { icon: 'tasks', tone: 'iris', color: 'var(--qw-iris)', label: 'procedures' },
  reflections: { icon: 'sparkle', tone: 'iris', color: 'var(--qw-iris)', label: 'reflections' },
  agent: { icon: 'user', tone: 'iris', color: 'var(--qw-iris)', label: 'agent' },
  flow: { icon: 'loop', tone: 'crux', color: 'var(--qw-crux)', label: 'flow' },
  'flow.step': { icon: 'arrowRight', tone: 'muted', color: 'var(--qw-fg-muted)', label: 'step' },
  composition: { icon: 'grid', tone: 'iris', color: 'var(--qw-iris)', label: 'composition' },
  'composition.parallel': { icon: 'grid', tone: 'iris', color: 'var(--qw-iris)', label: 'parallel' },
  'composition.parallel.branch': { icon: 'layers', tone: 'iris', color: 'var(--qw-iris)', label: 'branch' },
  'composition.pipeline': { icon: 'arrowRight', tone: 'iris', color: 'var(--qw-iris)', label: 'pipeline' },
  'composition.pipeline.stage': { icon: 'arrowRight', tone: 'iris', color: 'var(--qw-iris)', label: 'stage' },
  'composition.consensus': { icon: 'check', tone: 'iris', color: 'var(--qw-iris)', label: 'consensus' },
  'composition.swarm': { icon: 'grid', tone: 'iris', color: 'var(--qw-iris)', label: 'swarm' },
  'routing.router': { icon: 'filter', tone: 'crux', color: 'var(--qw-crux)', label: 'router' },
  'routing.router.route': { icon: 'arrowRight', tone: 'muted', color: 'var(--qw-fg-muted)', label: 'route' },
  'routing.cascade': { icon: 'layers', tone: 'crux', color: 'var(--qw-crux)', label: 'cascade' },
  'routing.cascade.tier': { icon: 'arrowDown', tone: 'muted', color: 'var(--qw-fg-muted)', label: 'tier' },
  'routing.fallback': { icon: 'loop', tone: 'crux', color: 'var(--qw-crux)', label: 'fallback' },
  'routing.fallback.option': { icon: 'arrowRight', tone: 'muted', color: 'var(--qw-fg-muted)', label: 'option' },
  rag: { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'rag' },
  'rag.knowledgeBase': { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'knowledge base' },
  'rag.recipe': { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'recipe' },
  'rag.recipe.step': { icon: 'arrowRight', tone: 'ok', color: 'var(--qw-ok)', label: 'step' },
  'rag.pipeline': { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'rag pipeline' },
  'rag.pipeline.stage': { icon: 'arrowRight', tone: 'ok', color: 'var(--qw-ok)', label: 'stage' },
  'rag.reranker': { icon: 'spark', tone: 'ok', color: 'var(--qw-ok)', label: 'reranker' },
  'rag.retriever': { icon: 'search', tone: 'ok', color: 'var(--qw-ok)', label: 'retriever' },
  workspace: { icon: 'folder', tone: 'ok', color: 'var(--qw-ok)', label: 'workspace' },
  constraint: { icon: 'alert', tone: 'warn', color: 'var(--qw-warn)', label: 'constraint' },
  guardrail: { icon: 'check', tone: 'warn', color: 'var(--qw-warn)', label: 'guardrail' },
  scorer: { icon: 'spark', tone: 'crux', color: 'var(--qw-crux)', label: 'scorer' },
}

export function glyphFor(kind: string): KindGlyph {
  return KIND_GLYPH[kind] ?? { icon: 'doc', tone: 'muted', color: 'var(--qw-fg-muted)', label: kind }
}

export function KindBadge({ name, color, size = 22 }: { name: IconName; color?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        background: 'var(--qw-bg-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px var(--qw-border)',
      }}
    >
      <Icon name={name} size={Math.round(size * 0.55)} color={color ?? 'var(--qw-fg-muted)'} />
    </div>
  )
}
