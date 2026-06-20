package devtools

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func hasCompleteProjectShardEvidence(index store.IndexData) bool {
	if index.SourceGraph == nil || !stringSliceContains(index.SourceGraph.Capabilities, "project-shards") || len(index.SourceGraph.Shards) == 0 {
		return false
	}
	for _, source := range index.Sources {
		if source.File == "" {
			continue
		}
		if source.ShardID != "" {
			continue
		}
		if shardIDForSourceFile(source.File, index.SourceGraph.Shards) == "" {
			return false
		}
	}
	return true
}

func shardIDForSourceFile(file string, shards []store.ProjectIndexShard) string {
	bestID := ""
	bestRootLen := -1
	for _, shard := range shards {
		if shard.Root == "" {
			continue
		}
		if file == shard.Root || strings.HasPrefix(file, shard.Root+"/") {
			if len(shard.Root) > bestRootLen {
				bestID = shard.ID
				bestRootLen = len(shard.Root)
			}
		}
	}
	return bestID
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
