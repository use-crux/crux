package projectindexer

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const (
	projectNativeStaticPlanTimingConfig                 = "native.plan.config"
	projectNativeStaticPlanTimingFileSelection          = "native.plan.file_selection"
	projectNativeStaticPlanTimingSourceGraph            = "native.plan.source_graph"
	projectNativeStaticPlanTimingCacheStatus            = "native.plan.cache_status"
	projectNativeStaticPlanTimingExtensionManifest      = "native.plan.extension_manifest"
	projectNativeStaticPlanTimingExtensionFileSelection = "native.plan.extension_file_selection"
)

func projectNativeStaticAppendPlanTiming(
	timings []devtools.ProjectIndexPhaseTiming,
	name string,
	started time.Time,
	count int,
) []devtools.ProjectIndexPhaseTiming {
	if name == "" || started.IsZero() {
		return timings
	}
	return append(timings, devtools.ProjectIndexPhaseTiming{
		Name:       name,
		DurationMs: elapsedMs(started),
		Count:      count,
	})
}
