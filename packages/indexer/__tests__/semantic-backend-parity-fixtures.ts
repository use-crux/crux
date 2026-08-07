import {
  contextDefinitionRef,
  promptDefinitionRef,
  retrieverDefinitionRef,
} from "@use-crux/core/observability";
import type { ProjectSourceRef } from "@use-crux/core/project-index";
import { completionSemanticParityFixture } from "./completion-semantic-parity-fixture";
import { promptTextSemanticParityFixtures } from "./prompt-text-semantic-parity-fixtures";

export interface ExpectedPromptTextSourceRef {
  readonly definitionId: string;
  readonly ref: ProjectSourceRef;
}

export interface SemanticBackendParityFixture {
  readonly name: string;
  /** Run outside the workspace so package imports intentionally stay unresolved. */
  readonly externalRoot?: boolean;
  /** Workspace packages linked into the fixture for real public import resolution. */
  readonly workspacePackages?: readonly string[];
  /** Additional compiler options written to the fixture tsconfig. */
  readonly compilerOptions?: Readonly<Record<string, unknown>>;
  readonly files: Readonly<Record<string, string>>;
  readonly expect: {
    readonly definitionIds?: readonly string[];
    /** Required facts emitted on named Project Index definitions. */
    readonly definitionFacts?: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    /** Facts that must stay absent from named Project Index definitions. */
    readonly definitionFactKeysAbsent?: Readonly<
      Record<string, readonly string[]>
    >;
    /** Exact profile objects emitted on named routing children. */
    readonly definitionProfiles?: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    readonly relationTypes?: readonly string[];
    readonly sourceRefRoles?: readonly string[];
    readonly lintRuleIds?: readonly string[];
    readonly diagnosticCodes?: readonly string[];
    readonly diagnosticDefinitionIds?: readonly string[];
    /** Exact prompt-text refs with project-relative source paths. */
    readonly promptTextSourceRefs?: readonly ExpectedPromptTextSourceRef[];
  };
}

/** Semantic fixtures that must produce identical facts for every backend. */
export const semanticBackendParityFixtures: readonly SemanticBackendParityFixture[] =
  [
    ...promptTextSemanticParityFixtures,
    {
      name: "authored-thread-definition-and-bindings",
      workspacePackages: ["core"],
      files: {
        "src/thread.ts": `
        import { agent, prompt } from '@use-crux/core'
        import { thread } from '@use-crux/core/thread'

        export const conversation = thread({ id: 'conversation' })
        export const answer = prompt({
          id: 'answer',
          use: [conversation],
          prompt: 'Answer the user',
        })
        export const worker = agent({
          id: 'worker',
          prompt: answer,
        })
      `,
      },
      expect: {
        definitionIds: ["thread:conversation"],
        relationTypes: ["prompt.uses_thread", "agent.uses_thread"],
      },
    },
    {
      name: "authored-session-targets-shared-analyzer",
      workspacePackages: ["core"],
      files: {
        "src/agents.ts": `
          import { agent } from '@use-crux/core/agent'
          export const importedAgent = agent({ id: 'imported-agent' })
        `,
        "src/sessions.ts": `
          import { agent } from '@use-crux/core/agent'
          import { getSession, session } from '@use-crux/core/session'
          import { importedAgent } from './agents'

          const localAgent = agent({ id: 'local-agent' })
          export const created = session(localAgent, { key: 'customer-a' })
          export const restored = getSession(importedAgent, 'customer-b')
        `,
      },
      expect: {
        definitionIds: [
          "session:local-agent:customer-a",
          "session:imported-agent:customer-b",
        ],
        definitionFacts: {
          "session:local-agent:customer-a": {
            operation: "create",
            targetDefinitionId: "agent:local-agent",
            key: { kind: "literal", value: "customer-a" },
            identity: "static",
          },
          "session:imported-agent:customer-b": {
            operation: "get",
            targetDefinitionId: "agent:imported-agent",
            key: { kind: "literal", value: "customer-b" },
            identity: "static",
          },
        },
        relationTypes: ["session.targets_agent"],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "authored-flow-session-targets-shared-analyzer",
      workspacePackages: ["core"],
      files: {
        "src/flows.ts": `
          import { flow } from '@use-crux/core/flow'
          export const checkout = flow('checkout', async () => ({ ok: true }))
        `,
        "src/flow-sessions.ts": `
          import { session } from '@use-crux/core/session'
          import { checkout } from './flows'
          export const order = session(checkout, { key: 'order-a' })
        `,
      },
      expect: {
        definitionIds: ["session:checkout:order-a"],
        definitionFacts: {
          "session:checkout:order-a": {
            operation: "create",
            targetDefinitionId: "flow:checkout",
            target: { kind: "flow" },
            key: { kind: "literal", value: "order-a" },
            identity: "static",
          },
        },
        relationTypes: ["session.targets_flow"],
        sourceRefRoles: ["config"],
      },
    },
    {
      // Local helpers named `flow` must not be treated as Crux Flow Session targets.
      name: "local-non-crux-flow-is-not-session-flow-target",
      workspacePackages: ["core"],
      files: {
        "src/local-flow-session.ts": `
          import { session } from '@use-crux/core/session'

          function flow(name: string, handler: () => Promise<{ ok: boolean }>) {
            return { name, run: handler }
          }

          export const localHelper = flow('local-helper', async () => ({ ok: true }))
          export const order = session(localHelper, { key: 'order-a' })
        `,
      },
      expect: {
        // Coverage assertions are empty; the fixture name has dedicated absence checks.
      },
    },
    {
      name: "session-subscribe-usage-shared-analyzer",
      workspacePackages: ["core"],
      files: {
        "src/session-subscribe.ts": `
          import { agent } from '@use-crux/core/agent'
          import { session } from '@use-crux/core/session'
          import { signal } from '@use-crux/core/signal'

          export const orderPaid = signal({ id: 'order.paid', schema: { parse: (v: unknown) => v } })
          const supportAgent = agent({ id: 'support-agent' })
          export const support = session(supportAgent, { key: 'customer-a' })
          void support.subscribe(orderPaid)
          void support.stream()
          void support.stats()
        `,
      },
      expect: {
        definitionIds: ["session:support-agent:customer-a"],
        definitionFacts: {
          "session:support-agent:customer-a": {
            usage: { subscribe: true, stream: true, stats: true },
            subscriptions: [
              {
                signalDefinitionId: "signal:order.paid",
                matchKind: "bare",
              },
            ],
          },
        },
        relationTypes: [
          "session.targets_agent",
          "session.subscribes_to_signal",
        ],
      },
    },
    {
      name: "non-owner-session-thread-mutation-shared-analyzer",
      workspacePackages: ["core"],
      files: {
        "src/session-mutation.ts": `
          import { agent } from '@use-crux/core/agent'
          import { session } from '@use-crux/core/session'

          const supportAgent = agent({ id: 'support-agent' })
          export const support = session(supportAgent, { key: 'customer-a' })
          support.thread.append({ role: 'user', content: 'unsafe' })
          support.thread.read()
        `,
      },
      expect: {
        definitionIds: ["session:support-agent:customer-a"],
        lintRuleIds: ["session.non_owner_thread_mutation"],
      },
    },
    {
      name: "authored-context-planning-shared-analyzer",
      workspacePackages: ["core"],
      files: {
        "src/planning.ts": `
          import {
            Agent,
            context,
            droppable,
            history,
            pipeline,
            prefer,
            prompt,
          } from '@use-crux/core'

          const full = context({ id: 'full', system: 'PRIVATE_PLANNING_SENTINEL' })
          const compact = context({ id: 'compact', system: 'Compact' })
          export const writer = prompt({
            id: 'writer',
            use: [full, droppable(prefer(full, compact)), history(), history.recent(3)],
          })
          export const writerAgent = new Agent({
            name: 'writer-agent',
            prompt: writer,
            model: 'provider:model',
            inputBudget: { max: 4096 },
            prepareStep: () => ({}),
          })
          export const workflow = pipeline({
            id: 'workflow',
            agents: [writerAgent],
            prepareInvocation: () => ({}),
          })
        `,
      },
      expect: {
        definitionIds: [
          "prompt:writer",
          "agent:writer-agent",
          "composition.pipeline:workflow",
        ],
        definitionFacts: {
          "prompt:writer": {
            contextPlanning: {
              history: { managed: 1, recent: 1 },
              contributions: [
                { index: 0, boundary: "required", wrappers: [] },
                {
                  index: 1,
                  boundary: "elastic",
                  wrappers: ["droppable", "prefer"],
                },
              ],
            },
          },
          "agent:writer-agent": {
            contextPlanning: {
              inputBudget: { scope: "definition", max: 4096 },
              hooks: ["prepareStep"],
            },
          },
          "composition.pipeline:workflow": {
            contextPlanning: { hooks: ["prepareInvocation"] },
          },
        },
        sourceRefRoles: ["callback", "config"],
        lintRuleIds: ["context-planning.history-cardinality"],
      },
    },
    {
      // Locks the semantic-backend-emitted DefinitionRef kinds — prompt,
      // context, and rag.retriever, the config-bearing primitives that produce
      // standalone semantic definitions — to the exact `ProjectDefinition.ID`
      // the runtime helpers in `@use-crux/core/observability` emit, so a runtime
      // span joins the Project Index by a byte-identical id on both the default
      // TypeScript semantic backend and the experimental native backend.
      // Authored ids are intentionally hostile (spaces + punctuation) to
      // exercise `safe_id` normalization; none place a literal `-` adjacent to
      // an invalid run, the one shape where the regex/pending-dash normalizers
      // legitimately differ. The relation-participant kinds (tool, agent, flow,
      // blackboard) and the composition roots are not standalone semantic
      // definitions; the runtime helpers build their ids with the same
      // `<kind>:<safeId(authoredId)>` construction, pinned by the core
      // definition-ref unit tests and the Rust composition/primitive facts.
      name: "definition-ref-canonical-ids-across-touched-kinds",
      files: {
        "src/index.ts": `
        import { context, prompt, tool } from '@use-crux/core'
        import { retriever } from '@use-crux/core/retrieval'
        import { inMemoryRecordStore } from '@use-crux/core/storage'
        import { z } from 'zod'

        export const searchTool = tool({
          name: 'search tool@v2',
          parameters: z.object({ query: z.string() }),
          execute: async () => ({}),
        })
        export const brandContext = context({
          id: 'Brand Context!',
          tools: { searchTool },
        })
        export const writerPrompt = prompt({
          id: 'Writer Prompt!',
          use: [brandContext],
          tools: { searchTool },
        })
        const docsRecords = inMemoryRecordStore()
        export const docsRetriever = retriever({
          id: 'Docs KB!',
          records: docsRecords,
        })
      `,
      },
      expect: {
        definitionIds: [
          contextDefinitionRef("Brand Context!").id,
          promptDefinitionRef("Writer Prompt!").id,
          retrieverDefinitionRef("Docs KB!").id,
        ],
        relationTypes: [
          "prompt.uses_context",
          "prompt.uses_tool",
          "context.uses_tool",
          "rag.retriever.uses_record_store",
        ],
        sourceRefRoles: ["config"],
      },
    },
    {
      name: "authored-mcp-shared-analyzer",
      workspacePackages: ["core", "mcp"],
      files: {
        "src/mcp.ts": `
        import { context, prompt, when } from '@use-crux/core'
        import { mcp, stdio } from '@use-crux/mcp'

        export const searchServer = mcp({
          id: 'search',
          transport: stdio({
            command: 'search-server',
            env: { MCP_TOKEN: 'SECRET_MCP_PARITY_TOKEN' },
          }),
          tools: { allow: ['lookup'], prefix: 'search_' },
        })
        export const researchContext = context({
          id: 'research',
          use: [when(() => true, searchServer)],
        })
        export const writerPrompt = prompt({
          id: 'writer',
          use: [searchServer],
        })
      `,
      },
      expect: {
        definitionIds: ["context:research", "prompt:writer"],
        relationTypes: [
          "context.uses_mcp_server",
          "prompt.uses_mcp_server",
          "mcp.server.provides_tool",
        ],
      },
    },
    {
      name: "authored-evidence-record-shared-analyzer",
      workspacePackages: ["core"],
      compilerOptions: { allowJs: true, checkJs: true },
      files: {
        "src/bridge.ts": `
          export { evidence as proof } from '@use-crux/core'
        `,
        "src/evidence.ts": `
          import { proof } from './bridge'
          const request = {
            role: 'verification',
            kind: 'output',
            data: { secret: 'PRIVATE_EVIDENCE_PARITY_SENTINEL' },
          } as const
          proof.record(request)
        `,
        "src/evidence.js": `
          import { evidence as proof } from '@use-crux/core'
          proof.record({
            role: 'intent',
            kind: 'custom.review',
            ref: { kind: 'artifact', id: 'PRIVATE_EVIDENCE_REF' },
          })
        `,
      },
      expect: {
        lintRuleIds: ["evidence.reserved-inline-kind"],
      },
    },
    completionSemanticParityFixture,
    {
      name: "authored-media-shared-analyzer",
      workspacePackages: ["ai", "core", "openai"],
      files: {
        "src/media.ts": `
        import { generate, generateImage as image, transcribe } from '@use-crux/ai'
        import { prompt, router } from '@use-crux/core'
        import { createOpenAI } from '@use-crux/openai'
        import type { ImageModel, LanguageModel, TranscriptionModel } from 'ai'
        import type OpenAI from 'openai'

        declare const client: OpenAI
        declare const imageModel: ImageModel
        declare const languageModel: LanguageModel
        declare const transcriptionModel: TranscriptionModel
        declare const audioBytes: Uint8Array
        declare const dynamicMessages: Parameters<typeof generate>[1]['messages']
        const openai = createOpenAI(client)
        const render = image
        const visionPrompt = prompt({ id: 'vision-prompt' })
        const route = router({
          id: 'vision-route',
          classify: () => 'vision' as const,
          routes: { vision: languageModel, default: languageModel },
        })
        const options = {
          model: imageModel,
          n: 2,
          size: '1024x1024',
        }
        export const cover = render(options)
        export const unsafe = openai.generate(visionPrompt, {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: [{ type: 'image', source: {
            type: 'provider-file', provider: 'google', fileId: 'private-file-id'
          } }] }],
        })
        export const routed = generate(visionPrompt, {
          model: route,
          messages: [{ role: 'user', content: [{ type: 'image', source: {
            type: 'asset-ref', ref: { uri: 'private-ref' }
          } }] }],
        })
        export const transcript = transcribe({
          model: transcriptionModel,
          audio: audioBytes,
          task: { type: 'translate', targetLanguage: 'SECRET_LANGUAGE' },
        })
        export const unknown = generate(visionPrompt, { model: route, messages: dynamicMessages })
      `,
      },
      expect: {
        definitionIds: [
          "media.operation:cover",
          "media.operation:routed",
          "media.operation:transcript",
          "media.operation:unsafe",
        ],
        definitionFacts: {
          "media.operation:cover": {
            kind: "media.operation",
            operation: "generateImage",
            outputModalities: ["image"],
            adapter: "ai-sdk",
            execution: "unknown",
            authoredOptions: { n: 2, size: "1024x1024" },
          },
          "media.operation:unsafe": {
            kind: "media.operation",
            operation: "generate",
            inputModalities: ["image"],
            adapter: "openai",
            model: "gpt-4o",
          },
          "media.operation:transcript": {
            kind: "media.operation",
            operation: "transcribe",
            adapter: "ai-sdk",
            authoredOptions: { task: "translate" },
          },
        },
        relationTypes: ["media.uses_prompt", "media.uses_routing"],
        sourceRefRoles: ["config"],
        lintRuleIds: [
          "media.invalid-provider-file",
          "media.asset-ref-not-hydrated",
          "media.output-discarded",
        ],
      },
    },
    {
      name: "authored-embedding-shared-analyzer",
      workspacePackages: ["ai", "core", "google", "openai"],
      files: {
        "src/embedding.ts": `
        import { embedding as coreEmbedding } from '@use-crux/core/embedding'
        import type { DenseEmbedding } from '@use-crux/core/embedding'
        import { indexer } from '@use-crux/core/indexing'
        import { retriever, knowledgeBase } from '@use-crux/core/retrieval'
        import { embedding as googleEmbedding } from '@use-crux/google'
        import { embedding as openAIEmbedding } from '@use-crux/openai'
        import { embedding as aiEmbedding } from '@use-crux/ai'

        declare const records: never
        declare const search: never
        declare const googleClient: never
        declare const openAIClient: never
        declare const mediaBytes: Uint8Array
        declare const dynamicModalities: readonly ['text']
        declare const dynamicDense: DenseEmbedding<'image'>
        const textConfig = { kind: 'dense' as const, name: 'text', dimensions: 3, maxInputTokens: 32, batch: { maxSize: 1 }, embed: async () => [] }
        const text = coreEmbedding(textConfig)
        const vision = coreEmbedding({ kind: 'dense', name: 'vision', dimensions: 4, maxInputTokens: 32, modalities: ['text', 'image'], batch: { maxSize: 1 }, embed: async () => [] })
        const sparse = coreEmbedding({ kind: 'sparse', name: 'sparse', maxInputTokens: 32, modalities: ['text'], batch: { maxSize: 1 }, embed: async () => [] })
        const dynamicSparse = coreEmbedding({ kind: 'sparse', name: 'dynamic', maxInputTokens: 32, modalities: dynamicModalities, batch: { maxSize: 1 }, embed: async () => [] })
        const googleConfig = { model: 'gemini-embedding-2' as const }
        const googleDense = googleEmbedding(googleClient, googleConfig)
        const openAIDense = openAIEmbedding(openAIClient, { name: 'openai', model: 'text-embedding-3-small' })
        const aiDense = aiEmbedding({ name: 'ai-sdk', model: 'provider:model', dimensions: 4, maxInputTokens: 32 })
        const writer = indexer({ id: 'writer', namespace: 'shared', records, search, dense: text })
        export const sparseWriter = indexer({ id: 'sparse-writer', namespace: 'sparse', records, search, sparse })
        const dynamicWriter = indexer({ id: 'dynamic-writer', namespace: 'dynamic', records, search, dense: dynamicDense })
        export const reader = retriever({ id: 'reader', namespace: 'shared', records, search, dense: vision })
        export const kb = knowledgeBase({ id: 'kb', records, search, embeddings: vision, sparseEmbeddings: sparse })
        export const providerKb = knowledgeBase({ id: 'provider-kb', records, search, embeddings: googleDense, sparseEmbeddings: dynamicSparse })
        void text.embed({ type: 'image', source: mediaBytes, mediaType: 'image/png' })
        void sparse.embed({ type: 'image', source: mediaBytes, mediaType: 'image/png' } as never)
        void googleDense.embed({ type: 'image', source: mediaBytes, mediaType: 'image/png' })
        void openAIDense.embed({ type: 'data', mediaType: 'image/png', data: mediaBytes } as never)
        void aiDense.embed('text')
        void dynamicDense.embed('PHASE7_PRIVATE_SENTINEL')
      `,
        "src/consumer-calls.ts": `
        import { kb, sparseWriter } from './embedding'
        declare const mediaBytes: Uint8Array
        const documents = [{ id: 'dog', parts: [{ type: 'image', asset: { type: 'data', mediaType: 'image/png', data: mediaBytes } }] }]
        void sparseWriter.indexDocuments(documents)
        void sparseWriter.indexChunks(documents as never)
        void kb.index(documents)
        void kb.reindex(documents)
      `,
      },
      expect: {
        relationTypes: [
          "embedding.call.uses_embedding",
          "rag.indexer.uses_dense_embedding",
          "rag.indexer.uses_sparse_embedding",
          "rag.retriever.uses_dense_embedding",
          "rag.knowledgeBase.uses_dense_embedding",
          "rag.knowledgeBase.uses_sparse_embedding",
        ],
        lintRuleIds: [
          "embedding.unsupported-modality",
          "embedding.namespace-identity-mismatch",
          "embedding.sparse-media",
        ],
        sourceRefRoles: ["config"],
      },
    },
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
        export const reviewerAgent = agent({ name: 'Reviewer' })
        export const writerAgent = agent({
          name: 'Writer',
          prompt: writerPrompt,
          tools: { ...sharedTools, reviewer: reviewerAgent },
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
          "agent.uses_agent_tool",
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
        // @ts-nocheck
        import * as coreStorage from '@use-crux/core/storage'
        import * as postgres from '@use-crux/postgres'

        const { inMemoryAssetStore, inMemoryRecordStore, storage } = coreStorage as any
        const inMemorySearchStore = (coreStorage as any).inMemorySearchStore
        const { postgresRecordStore, postgresStorage } = postgres as any
        const postgresSearchStore = (postgres as any).postgresSearchStore

        export const recordsAlias = inMemoryRecordStore()
        export const search = inMemorySearchStore()
        export const assets = inMemoryAssetStore()
        const bundleParts = { records: recordsAlias, search, assets }
        export const appStorage = storage(bundleParts as never)
        export const inlineStorage = { records: recordsAlias, search, assets }
        export const tenantStorage = storage.scope(appStorage as never, 'tenant-a')
        export const pgRecords = postgresRecordStore()
        export const pgSearch = postgresSearchStore({ dimensions: 2, sparseDimensions: 8 })
        export const pgStorage = postgresStorage({ dimensions: 2, sparseDimensions: 8 })
      `,
        "src/usage.ts": `
        // @ts-nocheck
        import { retriever, workspace } from '@use-crux/core'
        import { appStorage, assets, recordsAlias as docsRecords, tenantStorage, search } from './storage'

        const retrieverConfig = {
          id: 'docs',
          storage: tenantStorage,
          records: docsRecords,
          search,
        }
        export const docsRetriever = retriever(retrieverConfig as never)

        const workspaceConfig = {
          id: 'scratch',
          storage: appStorage,
          records: docsRecords,
          assets,
        }
        export const scratch = workspace(workspaceConfig as never)
      `,
      },
      expect: {
        definitionIds: [
          "storage.recordStore:recordsAlias",
          "storage.searchStore:search",
          "storage.assetStore:assets",
          "storage.bundle:appStorage",
          "storage.bundle:inlineStorage",
          "storage.scope:tenantStorage",
          "storage.recordStore:pgRecords",
          "storage.searchStore:pgSearch",
          "storage.bundle:pgStorage",
          "rag.retriever:docs",
          "workspace:scratch",
        ],
        relationTypes: [
          "storage.bundle.uses_record_store",
          "storage.bundle.uses_search_store",
          "storage.bundle.uses_asset_store",
          "storage.scope.wraps_storage",
          "rag.retriever.uses_storage",
          "rag.retriever.uses_record_store",
          "rag.retriever.uses_search_store",
          "workspace.uses_storage",
          "workspace.uses_record_store",
          "workspace.uses_asset_store",
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
      name: "routing-context-and-call-profile",
      externalRoot: true,
      files: {
        "src/routing.ts": `
        import { prompt } from '@use-crux/core'
        import { router, split, type RouteArgs } from '@use-crux/core/routing'

        export const writer = prompt({ id: 'routing-context-writer' })
        declare const dynamicProfileTag: string

        function classifyTenant({ context }: RouteArgs<{ tenantId: string; tier: 'free' | 'pro' }>) {
          return context.tier === 'pro' ? 'pro' : 'default'
        }

        function seedTenant({ context }: RouteArgs<{ tenantId: string; tier: 'free' | 'pro' }>) {
          return context.tenantId
        }

        export const tenantRouter = router({
          id: 'tenant-router',
          classify: classifyTenant,
          routes: {
            pro: {
              model: writer,
              temperature: 0.2,
              maxTokens: 1200,
              providerOptions: { cache: true, tag: dynamicProfileTag },
            },
            default: writer,
          },
        })

        export const tenantSplit = split({
          id: 'tenant-split',
          seed: seedTenant,
          routes: {
            stable: { model: writer, weight: 100, temperature: 0.1 },
          },
        })

        export const contextFreeRouter = router({
          id: 'context-free-router',
          classify: () => 'default',
          routes: { default: writer },
        })
      `,
      },
      expect: {
        definitionIds: [
          "routing.router:tenant-router",
          "routing.router:tenant-router:route:pro",
          "routing.split:tenant-split",
          "routing.split:tenant-split:route:stable",
          "routing.router:context-free-router",
        ],
        definitionFacts: {
          "routing.router:tenant-router": {
            routingContextType: '{ tenantId: string; tier: "free" | "pro"; }',
            routingContextRequired: true,
          },
          "routing.split:tenant-split": {
            routingContextType: '{ tenantId: string; tier: "free" | "pro"; }',
            routingContextRequired: true,
          },
          "routing.router:tenant-router:route:pro": {
            profile: { temperature: 0.2, maxTokens: 1200 },
          },
          "routing.split:tenant-split:route:stable": {
            profile: { weight: 100, temperature: 0.1 },
          },
        },
        definitionFactKeysAbsent: {
          "routing.router:context-free-router": [
            "routingContextType",
            "routingContextRequired",
          ],
          "routing.router:context-free-router:route:default": ["profile"],
        },
        definitionProfiles: {
          "routing.router:tenant-router:route:pro": {
            temperature: 0.2,
            maxTokens: 1200,
          },
          "routing.split:tenant-split:route:stable": {
            weight: 100,
            temperature: 0.1,
          },
        },
        relationTypes: ["router.route.uses_prompt", "split.route.uses_prompt"],
        sourceRefRoles: ["callback", "config"],
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
      name: "workspace-snapshot-grouped-facet-relations",
      files: {
        "src/resources.ts": `
        import { workspace } from '@use-crux/core'

        export const scratch = workspace({ id: 'scratch' })
      `,
        "src/app.ts": `
        import { tool } from '@use-crux/core'
        import { scratch } from './resources'

        async function manageSnapshots() {
          const ref = await scratch.snapshot.create({ path: '/drafts' })
          await scratch.snapshot.list({ path: '/drafts' })
          await scratch.snapshot.restore(ref)
          await scratch.snapshot.delete(ref)
        }

        export const snapshotTool = tool({
          name: 'snapshotTool',
          execute: manageSnapshots,
        })
      `,
      },
      expect: {
        relationTypes: [
          "tool.creates_workspace_snapshot",
          "tool.lists_workspace_snapshots",
          "tool.restores_workspace_snapshot",
          "tool.deletes_workspace_snapshot",
        ],
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
        import { evaluate } from '@use-crux/core/eval'
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
        export const writerEval = evaluate({ id: 'writer-eval', task: (input: { draft: string }) => input.draft, cases: [] })
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
