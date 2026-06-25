import { resolve } from 'node:path'
import { API, type Project, type Snapshot } from '@typescript/native-preview/unstable/sync'
import ts from 'typescript'
import type { IndexPatchFacts } from '../../../patches'
import type { SemanticCompilerSourceFile } from '../../compiler-view'
import type { SemanticBackendIdentity, SemanticProjectSessionIdentity } from '../../service/types'
import type { SemanticSourceProfile } from '../../source-profile'
import { resolveTsgoExecutablePath } from './executable'
import { createTsgoCompilerView, type TsgoSemanticCompilerView } from './compiler-view'
import {
  nativeDirectCandidateFiles,
  nativeDirectEvidenceForFiles,
  type NativeDirectEvidenceResult,
} from './direct-projectors/evidence'
import { createTsgoProjectConfig, type TsgoProjectConfig } from './project-config'
import { createTsgoTypeScriptSourceCache } from './source-cache'

export interface TsgoSemanticCompilerSession {
  /** Source files selected for analyzer candidate discovery. */
  readonly sourceFiles: readonly ts.SourceFile[]
  /** Compiler view backed by the TypeScript-Go API. */
  readonly view: TsgoSemanticCompilerView
  /** Disposes the native snapshot and temporary config for this analysis. */
  close(): void
}

export interface TsgoSemanticCompilerAnalyzeInput {
  /** Files selected for semantic analyzer candidate discovery. */
  readonly files: readonly string[]
  /** Dependency closure used to map resolved declarations back to TS AST nodes. */
  readonly dependencyClosure: readonly string[]
  /** Source profile collected during semantic preflight. */
  readonly sourceProfile: SemanticSourceProfile
}

export interface TsgoSemanticCompilerHost {
  /** Projects supported direct sources directly from the native TypeScript-Go AST. */
  analyzeNativeDirect(input: TsgoSemanticCompilerAnalyzeInput): NativeDirectEvidenceResult | undefined
  /** Creates one analysis-scoped native snapshot. */
  analyze(input: TsgoSemanticCompilerAnalyzeInput): TsgoSemanticCompilerSession
  /** Closes the reusable native-preview API process. */
  close(): void
}

export interface TsgoSemanticCompilerHostInput {
  /** Absolute Project Index root. */
  readonly root: string
  /** Semantic project identity used for tsconfig selection. */
  readonly session: SemanticProjectSessionIdentity
  /** Backend identity attached to this compiler view. */
  readonly identity: SemanticBackendIdentity
  /** Optional TypeScript-Go executable path for the unstable native-preview API. */
  readonly tsserverPath?: string
}

/**
 * Creates a reusable TypeScript-Go compiler host for one semantic project.
 *
 * The host keeps the native-preview API process alive across analyses, while
 * each analysis owns its snapshot and temporary config. This avoids repeatedly
 * spawning TypeScript-Go for unchanged backend sessions without making source
 * snapshots mutable across requests.
 */
export function createTsgoSemanticCompilerHost(input: TsgoSemanticCompilerHostInput): TsgoSemanticCompilerHost {
  const tsserverPath = resolveTsgoExecutablePath({ root: input.root, explicitPath: input.tsserverPath })
  const api = new API({ cwd: input.root, tsserverPath })
  const projectConfigs = new Map<string, TsgoProjectConfig>()
  const maxProjectConfigs = 4

  return {
    analyzeNativeDirect(analyzeInput) {
      return createNativeDirectEvidence(analyzeInput)
    },
    analyze(analyzeInput) {
      return createTsgoSemanticCompilerSession(analyzeInput)
    },
    close() {
      projectConfigs.forEach((projectConfig) => projectConfig.close())
      projectConfigs.clear()
      api.close()
    },
  }

  function projectConfigFor(analyzeInput: TsgoSemanticCompilerAnalyzeInput): TsgoProjectConfig {
    const key = tsgoProjectConfigCacheKey(
      input.session.tsconfigFiles,
      analyzeInput.files,
      analyzeInput.dependencyClosure,
    )
    const cached = projectConfigs.get(key)
    if (cached) return cached

    while (projectConfigs.size >= maxProjectConfigs) {
      const oldestKey = projectConfigs.keys().next().value
      if (!oldestKey) break
      projectConfigs.get(oldestKey)?.close()
      projectConfigs.delete(oldestKey)
    }

    const projectConfig = createTsgoProjectConfig({
      tsconfigFiles: input.session.tsconfigFiles,
      files: analyzeInput.files,
      dependencyClosure: analyzeInput.dependencyClosure,
    })
    projectConfigs.set(key, projectConfig)
    return projectConfig
  }

  function createNativeDirectEvidence(
    analyzeInput: TsgoSemanticCompilerAnalyzeInput,
  ): NativeDirectEvidenceResult | undefined {
    const candidateFiles = nativeDirectCandidateFiles(analyzeInput.files, analyzeInput.sourceProfile)
    if (candidateFiles.length === 0) return undefined
    const projectConfig = projectConfigFor(analyzeInput)
    let snapshot: Snapshot | undefined

    try {
      snapshot = api.updateSnapshot(openProjectParams(projectConfig.tsconfigFiles))
      const project = projectForInput(snapshot.getProjects(), projectConfig.tsconfigFiles, analyzeInput.files)
      const direct = project ? nativeDirectEvidenceForFiles(project, candidateFiles) : undefined
      if (!direct) return undefined
      return {
        facts: direct.facts,
        supportedFiles: direct.supportedFiles,
        unsupportedFiles: sortedUnique([
          ...direct.unsupportedFiles,
          ...analyzeInput.files.filter((file) => !candidateFiles.includes(file)),
        ]),
      }
    } finally {
      closeTsgoAnalysisResources(snapshot)
    }
  }

  function createTsgoSemanticCompilerSession(
    analyzeInput: TsgoSemanticCompilerAnalyzeInput,
  ): TsgoSemanticCompilerSession {
    const projectConfig = projectConfigFor(analyzeInput)
    let snapshot: Snapshot | undefined

    try {
      snapshot = api.updateSnapshot(openProjectParams(projectConfig.tsconfigFiles))
      const project = projectForInput(snapshot.getProjects(), projectConfig.tsconfigFiles, analyzeInput.files)
      if (!project) throw new Error('TypeScript-Go semantic backend could not create a project for selected files.')

      const sourceCache = createTsgoTypeScriptSourceCache([...analyzeInput.dependencyClosure, ...analyzeInput.files])
      const view = createTsgoCompilerView(input.identity, project, sourceCache)

      return {
        sourceFiles: sourceCache.sourceFiles(analyzeInput.files),
        view,
        close() {
          closeTsgoAnalysisResources(snapshot)
        },
      }
    } catch (error) {
      closeTsgoAnalysisResources(snapshot)
      throw error
    }
  }
}

function openProjectParams(tsconfigFiles: readonly string[]): { readonly openProject?: string } | undefined {
  return tsconfigFiles[0] ? { openProject: tsconfigFiles[0] } : undefined
}

function projectForInput(
  projects: readonly Project[],
  tsconfigFiles: readonly string[],
  files: readonly string[],
): Project | undefined {
  const config = tsconfigFiles[0] ? resolve(tsconfigFiles[0]) : undefined
  return (
    (config ? projects.find((project) => resolve(project.configFileName) === config) : undefined) ??
    projects.find((project) => files.some((file) => project.rootFiles.includes(file))) ??
    projects[0]
  )
}

function closeTsgoAnalysisResources(snapshot: Snapshot | undefined): void {
  snapshot?.dispose()
}

function tsgoProjectConfigCacheKey(
  tsconfigFiles: readonly string[],
  files: readonly string[],
  dependencyClosure: readonly string[],
): string {
  return JSON.stringify({
    tsconfigFiles,
    files: [...files].sort(),
    dependencyClosure: [...dependencyClosure].sort(),
  })
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}
