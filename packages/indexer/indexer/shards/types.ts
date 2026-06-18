import type { ProjectIndexShard } from '@crux/core/project-index'

/**
 * Project shard graph discovered from package and TypeScript workspace files.
 *
 * The graph is read-model evidence for planning. It does not imply that each
 * shard is indexed by a separate worker yet.
 */
export interface ProjectShardGraph {
  /** Stable package/workspace shards sorted by shard id. */
  readonly shards: readonly ProjectIndexShard[]
}

/**
 * Static source files grouped by the shard that owns them.
 *
 * Shard batches are execution units for syntax/source work. They preserve the
 * public Project Index shape while letting the compiler avoid one flat project
 * file set internally.
 */
export interface ProjectShardFileBatch {
  /** Shard that owns every file in this batch. */
  readonly shard: ProjectIndexShard
  /** Absolute files owned by the shard, sorted for deterministic extraction. */
  readonly files: readonly string[]
}
