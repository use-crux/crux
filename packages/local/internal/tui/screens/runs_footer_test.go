package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestRunsFooterOmitsUnbuiltVerbs asserts the Runs screen's action-bar
// footer no longer advertises `f flame chart` and `t timeline` — those
// labels were aspirational; no handler ever wired them. Per the
// KEYBINDS contract, the status/footer hints must reflect what the
// screen actually does. See S7 in the plan.
func TestRunsFooterOmitsUnbuiltVerbs(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.detail = &api.InspectRunDetailRecord{
		Run: api.InspectRunRecord{TraceID: "8af2f1c", TargetID: "docs_agent"},
		Spans: []api.InspectRunSpan{
			{ID: "sp1", Name: "agent", Kind: "agent"},
		},
	}
	r.selRun = "8af2f1c"
	r.selSpan = "sp1"

	out := r.View(Size{Width: 160, Height: 40})
	for _, label := range []string{"flame chart", "timeline"} {
		if strings.Contains(out, label) {
			t.Errorf("Runs footer still advertises %q — should be dropped per KEYBINDS contract", label)
		}
	}
}
