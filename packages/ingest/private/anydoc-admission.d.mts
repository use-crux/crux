import type { IngestedDocument } from '../src/types.js'

export type AnydocAdmissionLimits = Readonly<{ expandedBytes?: number; resultBytes?: number }>
export type AnydocAdmission = Readonly<{
  native: Readonly<{ kind: 'anydoc-native-v2'; source: Readonly<{ documentSha256: string; format?: string }>; observed: Readonly<{ blockCount: number; noteCount: number; assets: readonly unknown[] }>; facts: readonly (Readonly<Record<string, unknown>> & { readonly kind: string })[] }>
  core: IngestedDocument
  relationships: Readonly<{ notes: readonly unknown[]; inlines: readonly unknown[] }>
}>

export declare function admitAnydocDocument(document: unknown, bytes: Uint8Array, sourceFormat?: string, limits?: AnydocAdmissionLimits): AnydocAdmission
export declare function extractAnydocNativeFacts(document: unknown, bytes: Uint8Array, producer?: Readonly<Record<string, string>>): readonly (Readonly<Record<string, unknown>> & { readonly kind: string })[]
export declare class AnydocAdmissionError extends Error { readonly code: 'invalid-result' | 'expanded-too-large' }
