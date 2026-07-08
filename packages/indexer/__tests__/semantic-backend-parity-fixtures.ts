export interface SemanticBackendParityFixture {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expect: {
    readonly definitionIds?: readonly string[];
    readonly relationTypes?: readonly string[];
    readonly sourceRefRoles?: readonly string[];
    readonly lintRuleIds?: readonly string[];
  };
}

/** Semantic fixtures that must produce identical facts for every backend. */
export const semanticBackendParityFixtures: readonly SemanticBackendParityFixture[] =
  [
    {
      name: "direct-crux-no-zod-native-path",
      files: {
        "src/index.ts": `
        import { context, prompt, tool } from '@use-crux/core'

        export const brandContext = context({ id: 'brand' })
        export const searchTool = tool({ name: 'search', execute: async () => ({}) })
        export const writerPrompt = prompt({
          id: 'writer-simple',
          system: 'Write clearly.',
          prompt: 'Draft the response.',
          use: [brandContext],
          tools: { searchTool },
        })
      `,
      },
      expect: {
        definitionIds: ["prompt:writer-simple"],
        relationTypes: ["prompt.uses_context", "prompt.uses_tool"],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "direct-crux-duplicate-variable-names",
      files: {
        "src/a.ts": `
        import { context, prompt, tool } from '@use-crux/core'

        export const sharedContext = context({ id: 'a.context' })
        export const sharedTool = tool({ name: 'a.tool', execute: async () => ({}) })
        export const sharedPrompt = prompt({
          id: 'a.prompt',
          use: [sharedContext],
          tools: { sharedTool },
        })
      `,
        "src/b.ts": `
        import { context, prompt, tool } from '@use-crux/core'

        export const sharedContext = context({ id: 'b.context' })
        export const sharedTool = tool({ name: 'b.tool', execute: async () => ({}) })
        export const sharedPrompt = prompt({
          id: 'b.prompt',
          use: [sharedContext],
          tools: { sharedTool },
        })
      `,
      },
      expect: {
        definitionIds: ["prompt:a.prompt", "prompt:b.prompt"],
        relationTypes: ["prompt.uses_context", "prompt.uses_tool"],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "schema-source-refs-and-agent-config",
      files: {
        "src/schema-fragments.ts": `
        import { z } from 'zod'
        export const NestedSchema = z.object({
          url: z.string().describe('Source URL'),
        })
      `,
        "src/shared.ts": `
        import { tool } from '@use-crux/core'
        import { z } from 'zod'
        import { NestedSchema } from './schema-fragments'

        export const WriterSchema = z.object({
          topic: z.string().describe('Topic to write about'),
          drafts: z.array(NestedSchema),
        })
        export const WRITER_SYSTEM = 'Write clearly.'
        export function renderPrompt(input: { topic: string }) {
          return 'Draft about ' + input.topic
        }
        export async function usageHandler() {}
        export const searchDocs = tool({ name: 'searchDocs', parameters: z.object({ query: z.string() }), execute: async () => [] })
        export const sharedTools = { searchDocs }
      `,
        "src/index.ts": `
        import { agent, prompt } from '@use-crux/core'
        import { WRITER_SYSTEM, WriterSchema, renderPrompt, sharedTools, usageHandler } from './shared'

        export const writerPrompt = prompt({
          id: 'writer',
          input: WriterSchema,
          system: WRITER_SYSTEM,
          prompt: renderPrompt,
        })
        export const writerAgent = agent({
          name: 'Writer',
          prompt: writerPrompt,
          tools: sharedTools,
          usageHandler,
          handoffs: ['Reviewer', { id: 'Editor', when: 'Needs editing' }],
        })
      `,
      },
      expect: {
        definitionIds: ["prompt:writer"],
        relationTypes: [
          "agent.uses_prompt",
          "agent.uses_tool",
          "agent.can_handoff_to",
        ],
        sourceRefRoles: ["schema", "system", "prompt", "config", "callback"],
      },
    },
    {
      name: "use-arrays-tool-maps-and-relations",
      files: {
        "src/primitives.ts": `
        import { context, injectable, memory, tool } from '@use-crux/core'

        export const brandContext = context({ id: 'brand' })
        export const localeContext = context({ id: 'locale' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const nestedInjection = injectable({ id: 'nested', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })
        export const sharedUse = [brandContext, guardInjection] as const

        export const searchTool = tool({ name: 'search', execute: async () => ({}) })
        export const citeTool = tool({ name: 'cite', execute: async () => ({}) })
        export const summarizeTool = tool({ name: 'summarize', execute: async () => ({}) })
        export const baseTools = { search: searchTool, cite: citeTool } as const
        export const editorialTools = { ...baseTools, summarize: summarizeTool } as const
        export function injectEditorialTools() {
          return { tools: editorialTools }
        }
      `,
        "src/authoring.ts": `
        import { context, injectable, prompt } from '@use-crux/core'
        import { baseTools, brandContext, editorialTools, guardInjection, injectEditorialTools, localeContext, nestedInjection, sessionMemory, sharedUse, summarizeTool } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer-relations',
          use: [...sharedUse, localeContext, sessionMemory],
          tools: editorialTools,
        })
        export const writerContext = context({
          id: 'writer-context',
          use: [guardInjection],
          tools: { ...baseTools, summarize: summarizeTool },
        })
        export const writerInjection = injectable({
          id: 'writer-injection',
          use: [brandContext, sessionMemory, nestedInjection],
          inject: injectEditorialTools,
        })
      `,
      },
      expect: {
        definitionIds: [
          "prompt:writer-relations",
          "context:writer-context",
          "injectable:writer-injection",
        ],
        relationTypes: [
          "prompt.uses_context",
          "prompt.uses_injectable",
          "prompt.uses_memory",
          "prompt.uses_tool",
          "context.uses_injectable",
          "context.uses_tool",
          "injectable.uses_context",
          "injectable.uses_memory",
          "injectable.uses_tool",
        ],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "storage-beta-aliases-configs-and-scopes",
      files: {
        "src/storage.ts": `
        import {
          inMemoryBlobStore,
          inMemoryRecordStore,
          inMemoryVectorStore,
          storage,
        } from '@use-crux/core/storage'

        export const recordsAlias = inMemoryRecordStore()
        export const vectors = inMemoryVectorStore()
        export const blobs = inMemoryBlobStore()
        const bundleParts = { records: recordsAlias, vectors, blobs }
        export const appStorage = storage(bundleParts)
        export const inlineStorage = { records: recordsAlias, vectors, blobs }
        export const tenantStorage = storage.scope(appStorage, 'tenant-a')
      `,
        "src/usage.ts": `
        import { retriever, workspace } from '@use-crux/core'
        import { appStorage, blobs, recordsAlias as docsRecords, tenantStorage, vectors } from './storage'

        const retrieverConfig = {
          id: 'docs',
          storage: tenantStorage,
          records: docsRecords,
          vectors,
        }
        export const docsRetriever = retriever(retrieverConfig)

        const workspaceConfig = {
          id: 'scratch',
          storage: appStorage,
          records: docsRecords,
          blobs,
        }
        export const scratch = workspace(workspaceConfig)
      `,
      },
      expect: {
        definitionIds: [
          "storage.recordStore:recordsAlias",
          "storage.vectorStore:vectors",
          "storage.blobStore:blobs",
          "storage.bundle:appStorage",
          "storage.bundle:inlineStorage",
          "storage.scope:tenantStorage",
          "rag.retriever:docs",
          "workspace:scratch",
        ],
        relationTypes: [
          "storage.bundle.uses_record_store",
          "storage.bundle.uses_vector_store",
          "storage.bundle.uses_blob_store",
          "storage.scope.wraps_storage",
          "rag.retriever.uses_storage",
          "rag.retriever.uses_record_store",
          "rag.retriever.uses_vector_store",
          "workspace.uses_storage",
          "workspace.uses_record_store",
          "workspace.uses_blob_store",
        ],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "conditional-use-and-definition-enrichment",
      files: {
        "src/primitives.ts": `
        import { blackboard, context, injectable, memory } from '@use-crux/core'

        export const brandContext = context({ id: 'brand' })
        export const policyContext = context({ id: 'policy' })
        export const guardInjection = injectable({ id: 'guard', inject: async () => ({}) })
        export const sessionMemory = memory({ id: 'session' })
        export const draftBoard = blackboard({ id: 'drafts' })
      `,
        "src/conditions.ts": `
        export function hasBrand(input: { brand?: string }) {
          return Boolean(input.brand)
        }
        export const includeDraftBoard = true
      `,
        "src/authoring.ts": `
        import { match, prompt, when } from '@use-crux/core'
        import { includeDraftBoard, hasBrand } from './conditions'
        import { brandContext, draftBoard, guardInjection, policyContext, sessionMemory } from './primitives'

        export const writerPrompt = prompt({
          id: 'writer-conditional',
          use: [
            when(hasBrand, brandContext),
            match({
              cases: {
                strict: [policyContext, guardInjection],
              },
              default: sessionMemory,
            }),
            includeDraftBoard && draftBoard,
          ],
        })
      `,
      },
      expect: {
        definitionIds: ["prompt:writer-conditional"],
        sourceRefRoles: ["policy", "config"],
      },
    },
    {
      name: "dynamic-tools-contributions-and-router-folds",
      files: {
        "src/safety.ts": `
        import { agent, constraint, guardrail, tool } from '@use-crux/core'

        export const safeTone = constraint({ name: 'safe-tone', check: () => ({ ok: true }) })
        export const factuality = constraint({ name: 'factuality', check: () => ({ ok: true }) })
        export const outputGuard = guardrail({ name: 'output-guard', phase: 'output', validate: () => ({ action: 'pass' }) })
        export const piiGuard = guardrail({ name: 'pii-guard', phase: 'output', validate: () => ({ action: 'pass' }) })
        export const baseConstraints = [safeTone] as const
        export const extraConstraints = [factuality] as const
        export const guardrails = [outputGuard, piiGuard] as const
        export const sharedMetadata = { source: 'brand', owner: 'editorial' }

        export const searchTool = tool({ name: 'search', description: 'Search', execute: async () => null })
        export const citeTool = tool({ name: 'cite', description: 'Cite', execute: async () => null })
        function makeToolMap() {
          return Math.random() > 0.5 ? { cite: citeTool } : {}
        }
        const dynamicName = 'computed'
        export const partialTools = { search: searchTool, ...makeToolMap(), [dynamicName]: citeTool }

        export const writerAgent = agent({ name: 'Writer' })
        export const routes = { draft: writerAgent }
      `,
        "src/authoring.ts": `
        import { injectable, prompt, router } from '@use-crux/core'
        import { baseConstraints, extraConstraints, guardrails, partialTools, routes, sharedMetadata } from './safety'

        export const writerPrompt = prompt({
          id: 'writer-dynamic',
          tools: partialTools,
        })
        export const safetyInjection = injectable({
          id: 'safety-injection',
          inject: async () => ({
            constraints: [...baseConstraints, ...extraConstraints],
            guardrails,
            metadata: { ...sharedMetadata, mode: 'strict' },
          }),
        })
        export const writerRouter = router({
          id: 'writer-router',
          routes,
          classify: async () => 'draft',
        })
      `,
      },
      expect: {
        definitionIds: [
          "prompt:writer-dynamic",
          "injectable:safety-injection",
          "routing.router:writer-router:route:draft",
        ],
        relationTypes: ["prompt.uses_tool", "router.route.uses_agent"],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "routing-split-retry-array-fallback",
      files: {
        "src/routing.ts": `
        import { prompt } from '@use-crux/core'
        import { cascade, fallback, retry, router, split } from '@use-crux/core/routing'

        function seedSession() {
          return 'session-1'
        }
        function classifyRoute() {
          return 'draft'
        }

        export const writerPrompt = prompt({ id: 'writer-route-target' })
        export const backupPrompt = prompt({ id: 'backup-route-target' })
        export const retriedWriter = retry(writerPrompt, { id: 'retried-writer', attempts: 2 })
        export const resilientWriter = fallback([retriedWriter, backupPrompt], { id: 'resilient-writer' })
        export const canarySplit = split({
          id: 'canary-split',
          seed: seedSession,
          routes: {
            stable: { model: writerPrompt, weight: 95 },
            canary: { model: backupPrompt, weight: 5 },
          },
        })
        export const qualityCascade = cascade({
          id: 'quality-routing',
          tiers: [{ model: canarySplit }, { model: resilientWriter }],
        })
        export const qualityRouter = router({
          id: 'quality-router',
          classify: classifyRoute,
          routes: {
            draft: { model: qualityCascade, maxTokens: 1200 },
            default: resilientWriter,
          },
        })
      `,
      },
      expect: {
        definitionIds: [
          "routing.retry:retried-writer:target:1",
          "routing.split:canary-split:route:stable",
          "routing.split:canary-split:route:canary",
          "routing.fallback:resilient-writer:option:1",
          "routing.router:quality-router:route:draft",
        ],
        relationTypes: [
          "retry.target.uses_prompt",
          "split.route.uses_prompt",
          "fallback.option.uses_retry",
          "cascade.tier.uses_split",
          "router.route.uses_cascade",
        ],
        sourceRefRoles: ["callback", "config"],
      },
    },
    {
      name: "workspace-history-read-relation",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'

        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
      `,
        "src/app.ts": `
        import { tool } from '@use-crux/core'
        import { scratch } from './resources'

        export const versioningTool = tool({
          name: 'versioningTool',
          execute: async () => {
            await scratch.history('/drafts/article.md')
          },
        })
      `,
      },
      expect: {
        definitionIds: ["workspace:scratch"],
        relationTypes: ["tool.reads_workspace"],
      },
    },
    {
      name: "workspace-source-backed-mount-enrichment",
      files: {
        "src/resources.ts": `
        import { retrieverWorkspaceMountSource, workspace } from '@use-crux/core'
        import { retriever } from '@use-crux/core/retrieval'

        const docsRetriever = retriever({ id: 'docs', retrieve: async () => [] })
        const customSource = {
          kind: 'custom',
          list: async () => ({ entries: [] }),
          read: async () => null,
          write: async () => null,
        }
        const mounts = [
          { path: '/provider', access: 'readwrite', source: customSource },
          { path: '/docs', access: 'read', source: { kind: 'retriever', retriever: docsRetriever } },
          { path: '/guide', access: 'read', source: retrieverWorkspaceMountSource(docsRetriever, { query: 'guide' }) },
        ]

        export const scratch = workspace({ id: 'scratch', mounts })
      `,
      },
      expect: {
        definitionIds: ["workspace:scratch"],
        relationTypes: ["workspace.mounts_path"],
      },
    },
    {
      name: "workspace-diff-read-relation",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'

        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
      `,
        "src/app.ts": `
        import { tool } from '@use-crux/core'
        import { scratch } from './resources'

        export const versioningTool = tool({
          name: 'versioningTool',
          execute: async () => {
            await scratch.diff('/drafts/article.md')
          },
        })
      `,
      },
      expect: {
        definitionIds: ["workspace:scratch"],
        relationTypes: ["tool.reads_workspace"],
      },
    },
    {
      name: "workspace-undo-write-relation",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'

        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
      `,
        "src/app.ts": `
        import { tool } from '@use-crux/core'
        import { scratch } from './resources'

        export const versioningTool = tool({
          name: 'versioningTool',
          execute: async () => {
            await scratch.undo('/drafts/article.md')
          },
        })
      `,
      },
      expect: {
        definitionIds: ["workspace:scratch"],
        relationTypes: ["tool.writes_workspace"],
      },
    },
    {
      name: "workspace-transaction-write-relation",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'

        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
      `,
        "src/app.ts": `
        import { tool } from '@use-crux/core'
        import { scratch } from './resources'

        export const transactionTool = tool({
          name: 'transactionTool',
          execute: async () => {
            await scratch.transaction(async (tx) => {
              await tx.write('/drafts/article.md', 'draft')
            })
          },
        })
      `,
      },
      expect: {
        definitionIds: ["workspace:scratch"],
        relationTypes: ["tool.writes_workspace"],
      },
    },
    {
      name: "data-access-relations-and-lint-facts",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'
        import { blackboard } from '@use-crux/core/agent'
        import { memory, workingState } from '@use-crux/core/memory'
        import { evaluate } from '@use-crux/core/quality'
        import { retriever } from '@use-crux/core/retrieval'
        import { llmJudge } from '@use-crux/core/scoring'
        import { z } from 'zod'

        const writeOnlyState = workingState({ id: 'state', schema: z.object({ draft: z.string().optional() }) })
        const readBackState = workingState({ id: 'state', schema: z.object({ draft: z.string().optional() }) })
        export const writeOnlyMemory = memory({ id: 'write-only-memory', blocks: [writeOnlyState] })
        export const readBackMemory = memory({ id: 'read-back-memory', blocks: [readBackState] })
        export const notes = blackboard({ id: 'notes', schema: z.object({ decision: z.string().optional() }) })
        export const scratch = workspace({ id: 'scratch', mounts: [{ path: '/drafts', access: 'readwrite' }] })
        export const docsRetriever = retriever({ id: 'docs', retrieve: async () => [] })
        export const factuality = llmJudge({ id: 'factuality', criteria: 'Factual', scale: { min: 0, max: 1 } })
        export const writerEval = evaluate('writer-eval', { task: (input: { draft: string }) => input.draft, data: [] })
      `,
        "src/helpers.ts": `
        import { docsRetriever, factuality, notes, readBackMemory, scratch, writeOnlyMemory, writerEval } from './resources'

        export async function persistWithoutRead() {
          await writeOnlyMemory.write('draft', 'done')
          await notes.update('decision', 'publish')
          await scratch.writeFile('/drafts/article.md', 'done')
          await scratch.rename('/drafts/article.md', '/drafts/article-final.md')
          await scratch.move('/drafts/article-final.md', '/drafts/article-ready.md')
          await scratch.copy('/drafts/article-ready.md', '/outputs/article.md')
          await scratch.finalize('/outputs/article.md')
        }
        export async function persistAndReadBack() {
          await readBackMemory.write('draft', 'done')
          return readBackMemory.read('draft')
        }
        export async function hydrateDraft() {
          await notes.write('status', 'ready')
          await scratch.exists('/drafts/article.md')
          await scratch.stat('/drafts/article.md')
          await scratch.grep('ready')
          await scratch.artifacts({ status: 'final' })
          await scratch.writeFile('/draft.md', 'done')
          await docsRetriever.retrieve('query')
          await factuality.score({ answer: 'done' })
          await writerEval.run({ input: 'draft' })
        }
      `,
        "src/barrel.ts": `
        export { hydrateDraft, persistAndReadBack, persistWithoutRead } from './helpers'
      `,
        "src/app.ts": `
        import { flow, tool } from '@use-crux/core'
        import { hydrateDraft, persistAndReadBack, persistWithoutRead } from './barrel'

        export const writerTool = tool({ name: 'writerTool', execute: persistWithoutRead })
        export const readBackTool = tool({ name: 'readBackTool', execute: persistAndReadBack })
        export const writerFlow = flow({
          name: 'writer-flow',
          handler: async (flow) => {
            await flow.step('hydrate', hydrateDraft)
          },
        })
      `,
      },
      expect: {
        definitionIds: [
          "memory:write-only-memory",
          "memory:read-back-memory",
          "workspace:scratch",
        ],
        relationTypes: [
          "tool.writes_memory",
          "tool.reads_memory",
          "tool.writes_blackboard",
          "tool.writes_workspace",
          "flow.step.writes_blackboard",
          "flow.step.writes_workspace",
          "flow.step.queries_retriever",
          "flow.step.uses_scorer",
          "flow.step.runs_eval",
        ],
      },
    },
  ];
