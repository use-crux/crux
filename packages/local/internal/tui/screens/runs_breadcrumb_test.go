package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestRunsBreadcrumbUsesRunNotTrace asserts that the Runs screen's
// breadcrumb path identifies the selected record as a "run", never a
// "trace". Per CONTEXT.md's Run entry, "Trace" is not a UI synonym for
// Run — breadcrumbs, labels, and nav items in the TUI must say "run".
func TestRunsBreadcrumbUsesRunNotTrace(t *testing.T) {
	r := NewRuns()
	r.selRun = "8af2f1c0deadbeef"
	r.loaded = true

	path, _ := r.Breadcrumb()

	joined := strings.Join(path, " / ")
	if strings.Contains(joined, "trace ") {
		t.Errorf("breadcrumb contains \"trace \" segment: %q — should say \"run \" per CONTEXT.md", joined)
	}
	foundRunSegment := false
	for _, seg := range path {
		if strings.HasPrefix(seg, "run ") {
			foundRunSegment = true
			break
		}
	}
	if !foundRunSegment {
		t.Errorf("breadcrumb has no \"run {id}\" segment: %q", path)
	}
}

// TestRunsBreadcrumbRightMetaUsesRunsNotTraces asserts the right-meta
// counter says "N runs", not "N traces".
func TestRunsBreadcrumbRightMetaUsesRunsNotTraces(t *testing.T) {
	r := NewRuns()
	r.loaded = true

	_, right := r.Breadcrumb()
	if strings.Contains(right, "traces") {
		t.Errorf("breadcrumb right-meta contains \"traces\": %q — should say \"runs\"", right)
	}
}

// TestRunsBreadcrumbSpanSegmentPrefixed asserts that when the user
// focuses a span, the breadcrumb's last segment is prefixed with "span:"
// so users can tell the run segment apart from the span segment.
// Example: `runs / run 8af2f1c / span: retrieve (loop)` per S7.
func TestRunsBreadcrumbSpanSegmentPrefixed(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.selRun = "8af2f1c0deadbeef"
	r.focus = focusSpanDetail
	r.detail = &api.InspectRunDetailRecord{
		Spans: []api.InspectRunSpan{
			{ID: "sp1", Name: "retrieve (loop)"},
		},
	}
	r.selSpan = "sp1"

	path, _ := r.Breadcrumb()
	last := path[len(path)-1]
	if !strings.HasPrefix(last, "span: ") {
		t.Errorf("last breadcrumb segment = %q, want prefix \"span: \" (e.g. \"span: retrieve (loop)\")", last)
	}
	if !strings.HasSuffix(last, "retrieve (loop)") {
		t.Errorf("last breadcrumb segment = %q, want suffix \"retrieve (loop)\"", last)
	}
}
