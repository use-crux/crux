package screens

import (
	"strings"
	"testing"
)

// TestScreenBreadcrumbsUseCanonicalRoots asserts that no screen's
// Breadcrumb() returns "quality" as a path segment. The workbench owns
// the workspace prefix ({project}:{target}); screens return only their
// screen-local segments, per the approved 2026-07-16 TUI stabilization design.
func TestScreenBreadcrumbsUseCanonicalRoots(t *testing.T) {
	all := map[string]Screen{
		"overview": NewOverview(),
		"insights": NewInsights(),
		"runs":     NewRuns(),
		"index":    NewIndex(),
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
