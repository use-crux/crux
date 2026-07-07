package workers

import "testing"

func TestProjectIndexAstBenchmarkReasonMetricsCoverNodeStartReasons(t *testing.T) {
	got := make(map[string]bool)
	for _, reason := range projectIndexNodeReasonBenchmarkNames {
		got[reason] = true
	}
	for _, reason := range []string{
		projectIndexNodeReasonStaticPlanInspection,
		projectIndexNodeReasonStaticIndexConfig,
		projectIndexNodeReasonStaticIndexExtensions,
		projectIndexNodeReasonStaticIndexEmpty,
		projectIndexNodeReasonStaticIndexEvidence,
		projectIndexNodeReasonStaticIndexRules,
		projectIndexNodeReasonStaticIndexIncomplete,
	} {
		if !got[reason] {
			t.Fatalf("projectIndexNodeReasonBenchmarkNames = %v, want reason %q", projectIndexNodeReasonBenchmarkNames, reason)
		}
	}
}
