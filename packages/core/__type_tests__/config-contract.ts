import { config, inMemoryCruxStore, type CruxConfig, type CruxPlugin } from '..'
import type { CruxObservabilityTransport } from '../observability'
import type { TokenizerFn } from '../tokenizer'
import type { PromptMiddleware } from '../types'

const middleware: PromptMiddleware = async (args, next) => next(args)
const tokenizer: TokenizerFn = (text) => text.length
const observabilityTransport: CruxObservabilityTransport = { send: () => undefined }
const plugin = {
  name: 'config-contract-plugin',
  install: () => ({}),
} satisfies CruxPlugin

const launchConfig = {
  quality: {
    include: ['evals/**/*.eval.ts', '**/*.eval.ts'],
    defaults: { replay: 'record-new' },
  },
  lint: {
    profile: 'recommended',
  },
  indexer: {
    trust: { mode: 'first-party-only' },
  },
  persistence: {
    store: inMemoryCruxStore(),
  },
  generation: {
    middleware,
    tokenizer,
    autoEscape: false,
    securityWarnings: true,
  },
  devtools: {
    serverUrl: 'http://localhost:4400',
    bridge: true,
  },
  observability: {
    enabled: false,
  },
  plugins: [plugin],
} satisfies CruxConfig

const crux = config(launchConfig)

const explicitObservabilityExport = {
  observability: {
    serverUrl: 'https://collector.example.com',
    transport: observabilityTransport,
    delivery: {
      maxPendingDeliveries: 4,
    },
  },
} satisfies CruxConfig

const experimentalNativeIndexer = {
  experimental: {
    indexer: {
      native: true,
    },
  },
} satisfies CruxConfig

const experimentalNativeIndexerWithPath = {
  experimental: {
    indexer: {
      native: {
        engine: 'tsgo',
        tsserverPath: '/usr/local/bin/tsgo',
      },
    },
  },
} satisfies CruxConfig

const experimentalNativeAstIndexer = {
  experimental: {
    indexer: {
      nativeAst: true,
    },
  },
} satisfies CruxConfig

const experimentalNativeAstAndSemanticIndexer = {
  experimental: {
    indexer: {
      nativeAst: { frontend: 'oxc' },
      native: {
        engine: 'tsgo',
      },
    },
  },
} satisfies CruxConfig

const experimentalNativeIndexerRejectsFallback = {
  experimental: {
    indexer: {
      native: {
        engine: 'tsgo',
        // @ts-expect-error Native indexing must not configure a TypeScript semantic fallback.
        fallback: 'typescript',
      },
    },
  },
} satisfies CruxConfig

const experimentalNativeIndexerRejectsNestedAst = {
  experimental: {
    indexer: {
      native: {
        engine: 'tsgo',
        // @ts-expect-error Native static AST is configured with sibling `nativeAst`.
        ast: true,
      },
    },
  },
} satisfies CruxConfig

const experimentalTsgoConfigIsRemoved = {
  experimental: {
    indexer: {
      // @ts-expect-error Native experiments use `experimental.indexer.native`.
      tsgo: true,
    },
  },
} satisfies CruxConfig

const legacySemanticBackendConfigIsRemoved = {
  indexer: {
    // @ts-expect-error Semantic backend experiments belong under top-level `experimental.indexer`.
    semantic: {
      backend: 'tsgo',
    },
  },
} satisfies CruxConfig

const promptsStayInSource = {
  // @ts-expect-error Prompts are authored in source and are not config-bound.
  prompts: [],
} satisfies CruxConfig

const contextsStayInSource = {
  // @ts-expect-error Contexts are authored in source and are not config-bound.
  contexts: [],
} satisfies CruxConfig

const toolsStayInSource = {
  // @ts-expect-error Tools are source-discovered, not registered through config().
  tools: [],
} satisfies CruxConfig

const registriesStayInSource = {
  // @ts-expect-error Registries are normal TypeScript values, not project config entries.
  registries: {},
} satisfies CruxConfig

const storeMustUsePersistenceDomain = {
  // @ts-expect-error Store configuration belongs under `persistence.store`.
  store: inMemoryCruxStore(),
} satisfies CruxConfig

const middlewareMustUseGenerationDomain = {
  // @ts-expect-error Middleware configuration belongs under `generation.middleware`.
  middleware,
} satisfies CruxConfig

const tokenizerMustUseGenerationDomain = {
  // @ts-expect-error Tokenizer configuration belongs under `generation.tokenizer`.
  tokenizer,
} satisfies CruxConfig

const runtimeIsNotAUserFacingBucket = {
  // @ts-expect-error Runtime is an internal mapping, not a user-facing config domain.
  runtime: {},
} satisfies CruxConfig

const devtoolsDoesNotOwnExportTransport = {
  devtools: {
    serverUrl: 'http://localhost:4400',
    // @ts-expect-error Export transports belong under `observability.transport`.
    transport: observabilityTransport,
  },
} satisfies CruxConfig

const devtoolsDoesNotOwnDeliveryPolicy = {
  devtools: {
    serverUrl: 'http://localhost:4400',
    // @ts-expect-error Delivery policy belongs under `observability.delivery`.
    delivery: { maxPendingDeliveries: 4 },
  },
} satisfies CruxConfig

void crux.config.persistence?.store
void crux.config.generation?.middleware
void crux.config.generation?.tokenizer
void crux
void explicitObservabilityExport
void experimentalNativeIndexer
void experimentalNativeIndexerWithPath
void experimentalNativeAstIndexer
void experimentalNativeAstAndSemanticIndexer
void experimentalTsgoConfigIsRemoved
void legacySemanticBackendConfigIsRemoved
void promptsStayInSource
void contextsStayInSource
void toolsStayInSource
void registriesStayInSource
void storeMustUsePersistenceDomain
void middlewareMustUseGenerationDomain
void tokenizerMustUseGenerationDomain
void runtimeIsNotAUserFacingBucket
void devtoolsDoesNotOwnExportTransport
void devtoolsDoesNotOwnDeliveryPolicy
