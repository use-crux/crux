package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRunsBreadcrumbUsesDisplayName(t *testing.T) {
	r := NewRuns()
	setRunsForTest(r, api.ObservabilityRunSummary{
		RunID: "run_demo_support_regression",
		Name:  "Refund answer · regression",
	})
	selectRunForTest(r, "run_demo_support_regression")

	path, _ := r.Breadcrumb()
	if got := path[len(path)-1]; got != "Refund answer · regression" {
		t.Fatalf("breadcrumb tail = %q, want display name", got)
	}
}

func TestRunsBreadcrumbFallsBackToMiddleTruncatedID(t *testing.T) {
	r := NewRuns()
	id := "run_demo_shared_prefix_with_a_distinguishing_tail"
	selectRunForTest(r, id)

	path, _ := r.Breadcrumb()
	got := path[len(path)-1]
	if !strings.Contains(got, "…") || !strings.HasPrefix(got, "run_demo") || !strings.HasSuffix(got, "tail") {
		t.Fatalf("fallback breadcrumb tail = %q, want middle-truncated id", got)
	}
	if strings.HasPrefix(got, "run ") {
		t.Fatalf("fallback breadcrumb retained redundant run prefix: %q", got)
	}
}

// TestRunsBreadcrumbRightMetaUsesRunsNotTraces asserts the right-meta
// counter says "N runs", not "N traces".
func TestRunsBreadcrumbRightMetaUsesRunsNotTraces(t *testing.T) {
	r := NewRuns()
	setRunsForTest(r)

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
	selectRunForTest(r, "8af2f1c0deadbeef")
	r.focus = focusSpanDetail
	setRunDiagnosisForTest(r, runDiagnosisFixture{
		Spans: []api.InspectRunSpan{
			{ID: "sp1", Name: "retrieve (loop)"},
		},
	})
	selectSpanForTest(r, "sp1")

	path, _ := r.Breadcrumb()
	last := path[len(path)-1]
	if !strings.HasPrefix(last, "span: ") {
		t.Errorf("last breadcrumb segment = %q, want prefix \"span: \" (e.g. \"span: retrieve (loop)\")", last)
	}
	if !strings.HasSuffix(last, "retrieve (loop)") {
		t.Errorf("last breadcrumb segment = %q, want suffix \"retrieve (loop)\"", last)
	}
}
