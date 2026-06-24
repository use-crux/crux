package staticplan

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const (
	TimingConfig                 = "native.plan.config"
	TimingFileSelection          = "native.plan.file_selection"
	TimingSourceGraph            = "native.plan.source_graph"
	TimingCacheStatus            = "native.plan.cache_status"
	TimingExtensionManifest      = "native.plan.extension_manifest"
	TimingExtensionFileSelection = "native.plan.extension_file_selection"
)

func AppendTiming(
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

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
