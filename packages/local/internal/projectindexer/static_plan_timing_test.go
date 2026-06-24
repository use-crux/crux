package projectindexer

import (
	"context"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func TestProjectNativeStaticPlanReportsSubphaseTimings(t *testing.T) {
	t.Setenv(staticCacheStatusEnv, "1")

	root := t.TempDir()
	writeNativeStaticEnabledConfig(t, root)
	fileWithNativeStaticSource(t, root, "src/writer.ts")

	worker := newTestWorker(t)
	defer worker.Close()

	result, err := worker.inspectProjectStaticSyntaxPlan(context.Background(), root, "", "timed-plan")
	if err != nil {
		t.Fatalf("inspectProjectStaticSyntaxPlan error = %v", err)
	}
	names := projectNativeStaticPlanTimingNames(result.Timings)
	for _, name := range []string{
		projectNativeStaticPlanTimingFileSelection,
		projectNativeStaticPlanTimingSourceGraph,
		projectNativeStaticPlanTimingCacheStatus,
	} {
		if !slices.Contains(names, name) {
			t.Fatalf("timing names = %v, want %s", names, name)
		}
	}
}

func projectNativeStaticPlanTimingNames(timings []devtools.ProjectIndexPhaseTiming) []string {
	names := make([]string, 0, len(timings))
	for _, timing := range timings {
		names = append(names, timing.Name)
	}
	return names
}
