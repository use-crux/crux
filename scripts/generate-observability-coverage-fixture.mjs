import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DEFINITION_KIND_COVERAGE } from '../packages/core/src/project-index/definition-kind-coverage.ts'

const outputUrl = new URL('../packages/core/src/project-index/fixtures/definition-coverage.json', import.meta.url)
const authoredId = 'connected'
const directRoles = {
  prompt: 'resolved-prompt', context: 'resolved-context', tool: 'invoked-tool', agent: 'invoked-agent',
  flow: 'invoked-flow', task: 'invoked-task', 'composition.parallel': 'invoked-composition',
  'composition.pipeline': 'invoked-composition', 'composition.consensus': 'invoked-composition',
  'composition.swarm': 'invoked-composition', 'routing.router': 'invoked-routing',
  'routing.split': 'invoked-routing', 'routing.retry': 'invoked-routing', 'routing.cascade': 'invoked-routing',
  'routing.fallback': 'invoked-routing', 'rag.recipe': 'invoked-recipe', 'rag.reranker': 'invoked-reranker',
  'rag.retriever': 'invoked-retriever', skill: 'loaded-skill', memory: 'invoked-memory',
  workspace: 'invoked-workspace', constraint: 'invoked-constraint', guardrail: 'invoked-guardrail',
  blackboard: 'invoked-blackboard',
}

const ref = (id, kind, role) => ({ id, kind, role })

function canonicalRef(kind) {
  if (kind in directRoles) return ref(`${kind}:${authoredId}`, kind, directRoles[kind])
  switch (kind) {
    case 'rag.knowledgeBase': return ref('rag.knowledgeBase:connected', kind, 'contributed-knowledge-base')
    case 'toolPolicy': return ref('toolPolicy:connected', kind, 'contributed-tool-policy')
    case 'flow.step': return ref('flow.step:connected:connected', kind, 'invoked-flow-step')
    case 'composition.parallel.branch': return ref('composition.parallel:connected:branch:connected', kind, 'invoked-composition-branch')
    case 'rag.recipe.step': return ref('rag.recipe:connected:step:connected', kind, 'invoked-recipe-step')
    case 'scorer': return ref('scorer:connected', kind, 'invoked-scorer')
    default: return undefined
  }
}

function expectedTreatment(descriptor) {
  if (descriptor.primary === 'directly-observed' || descriptor.runtimeIdentity === 'definition-ref') return 'definition-ref'
  if (descriptor.runtimeIdentity === 'parent-derived') return 'parent-derived'
  if (descriptor.primary === 'quality-owned' || descriptor.secondary?.includes('quality-owned')) return 'quality'
  return 'none'
}

const fixture = {
  schemaVersion: 1,
  generatedFrom: 'DEFINITION_KIND_COVERAGE',
  adapters: ['@use-crux/openai', '@use-crux/anthropic', '@use-crux/google', '@use-crux/ai'],
  cases: Object.entries(DEFINITION_KIND_COVERAGE).map(([kind, descriptor]) => ({
    kind,
    primary: descriptor.primary,
    secondary: descriptor.secondary ?? [],
    runtimePrimitiveNames: descriptor.runtimePrimitiveNames ?? [],
    expectedTreatment: expectedTreatment(descriptor),
    definitionRef: canonicalRef(kind) ?? null,
  })),
}

const serialized = `${JSON.stringify(fixture, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = await readFile(outputUrl, 'utf8').catch(() => '')
  if (current !== serialized) {
    process.stderr.write(`stale generated fixture: ${fileURLToPath(outputUrl)}\n`)
    process.exitCode = 1
  }
} else {
  await writeFile(outputUrl, serialized)
}
