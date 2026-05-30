package screens

import (
	"strings"
	"testing"
)

// TestScreenBreadcrumbsDoNotPrependQuality asserts that no screen's
// Breadcrumb() returns "quality" as a path segment. The workbench owns
// the workspace prefix ({project}:{target}); screens return only their
// screen-local segments. See ADR-0050 + the TUI V1 implementation plan.
func TestScreenBreadcrumbsDoNotPrependQuality(t *testing.T) {
	all := map[string]Screen{
		"overview":    NewOverview(),
		"insights":    NewInsights(),
		"runs":        NewRuns(),
		"experiments": NewExperiments(),
		"compare":     NewCompare(),
		"suites":      NewDatasets(),
		"baselines":   NewBaselines(),
		"feedback":    NewFeedback(),
		"cassettes":   NewCassettes(),
	}
	for name, s := range all {
		path, _ := s.Breadcrumb()
		for _, seg := range path {
			if strings.EqualFold(seg, "quality") {
				t.Errorf("screen %q breadcrumb has \"quality\" segment %v — workbench owns the workspace prefix", name, path)
			}
		}
	}
}
