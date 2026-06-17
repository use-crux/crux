import { config, inMemoryCruxStore, type CruxConfig, type CruxPlugin } from '..'
import type { TokenizerFn } from '../tokenizer'
import type { PromptMiddleware } from '../types'

const middleware: PromptMiddleware = async (args, next) => next(args)
const tokenizer: TokenizerFn = (text) => text.length
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

void crux.config.persistence?.store
void crux.config.generation?.middleware
void crux.config.generation?.tokenizer
void crux
void promptsStayInSource
void contextsStayInSource
void toolsStayInSource
void registriesStayInSource
void storeMustUsePersistenceDomain
void middlewareMustUseGenerationDomain
void tokenizerMustUseGenerationDomain
void runtimeIsNotAUserFacingBucket
