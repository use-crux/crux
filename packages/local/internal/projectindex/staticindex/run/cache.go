package run

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

// writeCache persists the finished patch and its source profile when Static
// Index caching is enabled. It is a no-op otherwise so the run pipeline stays
// cache-agnostic.
func writeCache(
	request Request,
	sourceInput sourceprofile.Input,
	preparePlan protocol.Plan,
	patch projectindex.IndexPatch,
) {
	if request.CacheDisabled || !cache.StatusEnabledFromEnv() {
		return
	}
	cache.WriteFromPatch(
		request.Root,
		request.Plan.CacheInputs,
		cache.SourceInput{
			Files:                 sourceInput.Files,
			SemanticSourceProfile: sourceInput.SemanticSourceProfile,
		},
		preparePlan,
		patch,
	)
}
