/**
 * Semantic indexing service contracts.
 *
 * The service boundary keeps compiler objects inside backend implementations.
 * Backends emit compiler-free semantic evidence and the service projects it
 * into Project Index patch facts.
 *
 * @module
 */

import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import type { IndexPatch, IndexPatchBudget } from '../../patches'
import type { SemanticEvidenceBatchSource } from '../evidence/projection'
import type { SemanticIndexInstrumentation } from '../instrumentation'
import type { SemanticSourceProfile } from '../source-profile'

/**
 * Identifies the semantic backend that produced facts for a session.
 *
 * Keep this identity stable across releases unless the backend output contract
 * changes. It participates in cache keys and worker diagnostics.
 */
export interface SemanticBackendIdentity<TName extends string = string> {
  /** Backend name, such as `typescript`. */
  readonly name: TName
  /** Backend implementation or protocol version. */
  readonly version: string
}

/**
 * Identifies the compiler runtime that owns semantic project state.
 *
 * The backend identity describes Crux's evidence adapter. The compiler runtime
 * identity describes the concrete compiler implementation behind that adapter,
 * such as the JavaScript TypeScript package or a TypeScript-Go executable.
 */
export interface SemanticCompilerRuntimeIdentity<TName extends string = string> {
  /** Compiler runtime name, such as `typescript` or `tsgo`. */
  readonly name: TName
  /** Compiler runtime, package, or protocol version. */
  readonly version: string
  /** Executable path or stable executable identifier when it affects output. */
  readonly executable?: string
}

/**
 * Stable identity for one semantic project session.
 *
 * The identity describes the semantic project state a backend is allowed to
 * reuse. Raw compiler programs, language services, and AST nodes deliberately
 * remain private to the backend process.
 */
export interface SemanticProjectSessionIdentity {
  /** Absolute Project Index root. */
  readonly root: string
  /** TypeScript or JavaScript config files selected for discovered shards. */
  readonly tsconfigFiles: readonly string[]
  /** Compiler runtime that owns project state for this session. */
  readonly compilerRuntime: SemanticCompilerRuntimeIdentity
  /** Crux-owned semantic compiler option identity. */
  readonly compilerOptionsId: string
  /** Backend implementation that owns the session. */
  readonly backend: SemanticBackendIdentity
}

/**
 * Backend characteristics used for planning, benchmarking, and diagnostics.
 *
 * The fields describe architectural behavior rather than marketing labels so
 * callers can compare backends without depending on compiler-specific APIs.
 */
export interface SemanticBackendCapabilities {
  /** Whether the backend can emit full semantic facts or diagnostics only. */
  readonly factProduction: 'complete' | 'diagnostic'
  /** Stability of the compiler-facing API used inside the backend. */
  readonly apiStability: 'stable' | 'experimental'
  /** Where compiler work happens relative to the JavaScript worker. */
  readonly transport: 'in-process' | 'process' | 'ipc'
  /** Whether expensive compiler state can be reused by the backend. */
  readonly sessionReuse: 'none' | 'backend'
}

/**
 * Input used when a backend creates or reuses a semantic project session.
 *
 * Sessions are the unit that owns expensive compiler state: TypeScript
 * programs, TypeScript-Go API clients, process handles, and caches. The
 * service owns file selection and budgets, while backends own compiler state.
 */
export interface SemanticBackendSessionInput {
  /** Absolute Project Index root. */
  readonly root: string
  /** Stable project/session identity for reuse and cache keys. */
  readonly identity: SemanticProjectSessionIdentity
  /** Optional timing hook used by benchmarks and worker diagnostics. */
  readonly instrumentation?: SemanticIndexInstrumentation
}

/**
 * Input used when a backend reports the compiler runtime for a project root.
 */
export interface SemanticBackendRuntimeIdentityInput {
  /** Absolute Project Index root. */
  readonly root: string
  /** Stable backend identity that will own the semantic session. */
  readonly backend: SemanticBackendIdentity
}

/**
 * Input passed to a semantic backend after selection and preflight succeed.
 */
export interface SemanticAnalyzeInput {
  /** Absolute Project Index root. */
  readonly root: string
  /** Absolute source files selected for semantic analysis. */
  readonly files: readonly string[]
  /** Preflight-measured local dependency closure for cache identity. */
  readonly dependencyClosure: readonly string[]
  /** Preflight source text, hashes, and byte counts shared with backend caches. */
  readonly sourceProfile: SemanticSourceProfile
  /** Optional timing hook used by benchmarks and worker diagnostics. */
  readonly instrumentation?: SemanticIndexInstrumentation
}

/** Compiler-free evidence stream returned by a semantic backend. */
export type SemanticAnalyzeResult = SemanticEvidenceBatchSource

/**
 * Compiler session used for one or more semantic analysis requests.
 */
export interface SemanticBackendSession {
  /** Stable identity for the compiler state owned by this session. */
  readonly identity: SemanticProjectSessionIdentity
  /** Produce streamed semantic evidence for the selected source files. */
  analyze(input: SemanticAnalyzeInput): SemanticAnalyzeResult | Promise<SemanticAnalyzeResult>
}

/**
 * Backend contract for semantic evidence production.
 *
 * Backends may use TypeScript, TypeScript-Go, language services, or another
 * implementation internally. The only stable output is compiler-free Crux
 * semantic evidence, which the service projects into Project Index facts.
 */
export interface SemanticBackend<TName extends string = string> {
  /** Stable backend identity used in cache/session keys. */
  readonly identity: SemanticBackendIdentity<TName>
  /** Operational characteristics for planning and diagnostics. */
  readonly capabilities: SemanticBackendCapabilities
  /** Runtime identity for the compiler implementation used by this backend. */
  compilerRuntimeIdentity?(
    input: SemanticBackendRuntimeIdentityInput,
  ): SemanticCompilerRuntimeIdentity | Promise<SemanticCompilerRuntimeIdentity>
  /** Create or reuse a compiler session for a semantic project identity. */
  createSession(input: SemanticBackendSessionInput): SemanticBackendSession | Promise<SemanticBackendSession>
}

/** Built-in semantic backend names. */
export type SemanticBackendName = 'typescript' | 'native'

/** Experimental native backend selection options. */
export interface NativeSemanticBackendSelection {
  /** Select the experimental native backend. */
  readonly name: 'native'
  /** Native engine implementation. Defaults to `tsgo`. */
  readonly engine?: 'tsgo'
  /** Optional TypeScript-Go executable path for native-preview API mode when `engine` is `tsgo`. */
  readonly tsserverPath?: string
}

/** Built-in TypeScript backend selection. */
export interface TypeScriptSemanticBackendSelection {
  /** Select the current JavaScript TypeScript compiler API backend. */
  readonly name: 'typescript'
}

/** Built-in backend selection data accepted by the semantic service. */
export type SemanticBackendSelection =
  | 'typescript'
  | TypeScriptSemanticBackendSelection
  | NativeSemanticBackendSelection

/** Custom backend instance or built-in backend selection. */
export type SemanticBackendOption<TName extends string = string> = SemanticBackend<TName> | SemanticBackendSelection

/** Options for constructing a semantic index service. */
export interface SemanticIndexServiceOptions<TName extends string = string> {
  /** Backend used for semantic fact production. Defaults to TypeScript. */
  readonly backend?: SemanticBackendOption<TName>
  /** Environment used for backend selection overrides. Defaults to `process.env`. */
  readonly env?: SemanticBackendSelectionEnv
}

/** Minimal environment map used for semantic backend selection. */
export type SemanticBackendSelectionEnv = Readonly<Record<string, string | undefined>>

/** Input for full semantic project indexing. */
export interface SemanticIndexProjectInput {
  /** Project root used for source discovery and config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /** Budget for semantic enrichment patches. */
  readonly semanticBudget?: IndexPatchBudget
  /** Optional timing hook for semantic indexing benchmarks and worker diagnostics. */
  readonly semanticInstrumentation?: SemanticIndexInstrumentation
  /** Built-in backend selection for this request. */
  readonly semanticBackend?: SemanticBackendSelection
  /** Existing snapshot used to select semantic files and source-ref support rows. */
  readonly previousIndex?: ProjectIndexSnapshot
  /** Optional AST/source handoff profile used to avoid duplicate source scanning. */
  readonly sourceProfile?: SemanticSourceProfile
}

/** Input for indexing a planner-selected semantic file set. */
export interface SemanticIndexFilesInput extends SemanticIndexProjectInput {
  /** Absolute source files selected by the caller or incremental planner. */
  readonly files: readonly string[]
  /** Optional AST/source handoff profile used to avoid duplicate source scanning. */
  readonly sourceProfile?: SemanticSourceProfile
  /** Optional caller-proven local source closure for cache identity and backend project setup. */
  readonly dependencyClosure?: readonly string[]
  /** Start timestamp to reuse across paired AST/semantic incremental patches. */
  readonly startedAt?: string
  /** Files added from a previous Project Index during full semantic selection. */
  readonly previousSourceExpansion?: number
}

/**
 * Semantic indexing façade used by public package entry points and workers.
 */
export interface SemanticIndexService {
  /** Build a semantic patch after selecting files from the project root. */
  indexProject(input: SemanticIndexProjectInput): Promise<IndexPatch>
  /** Build a semantic patch for an already selected source file set. */
  indexFiles(input: SemanticIndexFilesInput): Promise<IndexPatch>
}
