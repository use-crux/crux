package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRunsViewUsesLayoutPreparedFromBodyResize(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-selected", Status: "failed"})
	selectRunForTest(runs, "run-selected")
	runs.Resize(Size{Width: 70, Height: 21})

	out := stripANSI(runs.View(Size{Width: 160, Height: 42}))

	if !strings.Contains(out, "run-sel") {
		t.Fatalf("prepared narrow layout hid selected run:\n%s", out)
	}
	if strings.Contains(out, "loading trace") || strings.Contains(out, "Run diagnosis") {
		t.Fatalf("view recomputed panes from render size instead of prepared body layout:\n%s", out)
	}
}
