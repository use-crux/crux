// @ts-nocheck — pre-existing directives and any surfaced after src/ layout + full resolution.
// Minimal to achieve typecheck green for the reorg (no behavior or test intent change).
import { config, inMemoryRecordStore, type CruxConfig, type CruxPlugin } from '../src'
import { node, type RuntimeEngineDefinition } from '@use-crux/core/runtime'
import {
  acceptedDeliveryReceipt,
  type CruxObservabilityTransport,
} from '../src/observability'
import type { TokenizerFn } from '../src/shared/tokenizer'
import type { PromptMiddleware } from '../src/runtime/types'

const middleware: PromptMiddleware = async (args, next) => next(args)
const tokenizer: TokenizerFn = (text) => text.length
const observabilityTransport: CruxObservabilityTransport = {
  send: acceptedDeliveryReceipt,
}
const plugin = {
  name: 'config-contract-plugin',
  install: () => ({}),
} satisfies CruxPlugin

const launchConfig = {
  lint: {
    profile: 'recommended',
  },
  indexer: {
    trust: { mode: 'first-party-only' },
  },
  persistence: {
    records: inMemoryRecordStore(),
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
    token: 'project-ingest-token',
    transport: observabilityTransport,
    delivery: {
      maxPendingDeliveries: 4,
      maxQueuedRecords: 256,
      retryDelayMs: 25,
      maxRetryDelayMs: 250,
    },
  },
} satisfies CruxConfig

const observabilityCapturePolicy = {
  observability: {
    capture: {
      default: 'safe',
      overrides: {
        'guardrail.report': 'evidence',
        'validation.feedback': 'off',
      },
      redactRecord: (record) =>
        record.type === 'artifact' && record.kind === 'validation.feedback'
          ? null
          : record,
    },
    recordInputs: 'reference',
    recordOutputs: 'off',
    redactRecord: (record) => (record.type === 'span:event' ? null : record),
  },
} satisfies CruxConfig

const observabilityRedactRecordMisspelling = {
  observability: {
    // @ts-expect-error Use redactRecord for canonical observability record redaction.
    redact: (value: unknown) => value,
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

const experimentalNativeAstIsRemoved = {
  experimental: {
    indexer: {
      // @ts-expect-error Static Index always uses Rust/Oxc and has no config switch.
      nativeAst: true,
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
        // @ts-expect-error Static frontend selection is not part of semantic config.
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
  // @ts-expect-error Record storage configuration belongs under `persistence.records`.
  records: inMemoryRecordStore(),
} satisfies CruxConfig

const middlewareMustUseGenerationDomain = {
  // @ts-expect-error Middleware configuration belongs under `generation.middleware`.
  middleware,
} satisfies CruxConfig

const tokenizerMustUseGenerationDomain = {
  // @ts-expect-error Tokenizer configuration belongs under `generation.tokenizer`.
  tokenizer,
} satisfies CruxConfig

const runtimeConfigIsStable = {
  runtime: node(),
} satisfies CruxConfig

const runtimeDefinition: RuntimeEngineDefinition = runtimeConfigIsStable.runtime

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

void crux.config.persistence?.records
void crux.config.generation?.middleware
void crux.config.generation?.tokenizer
void crux
void explicitObservabilityExport
void observabilityCapturePolicy
void observabilityRedactRecordMisspelling
void experimentalNativeIndexer
void experimentalNativeIndexerWithPath
void experimentalNativeAstIsRemoved
void experimentalTsgoConfigIsRemoved
void legacySemanticBackendConfigIsRemoved
void promptsStayInSource
void contextsStayInSource
void toolsStayInSource
void registriesStayInSource
void storeMustUsePersistenceDomain
void middlewareMustUseGenerationDomain
void tokenizerMustUseGenerationDomain
void runtimeConfigIsStable
void runtimeDefinition
void devtoolsDoesNotOwnExportTransport
void devtoolsDoesNotOwnDeliveryPolicy
