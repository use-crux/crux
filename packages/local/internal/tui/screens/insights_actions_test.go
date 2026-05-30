package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func sampleInsight() api.QualityInsightRecord {
	return api.QualityInsightRecord{
		InsightID:      "INS-014",
		Title:          "docs_agent loops on retrieval",
		Severity:       "high",
		TargetID:       "docs_agent",
		LinkedTraceIDs: []string{"run-8af2f1c", "run-3d1822b"},
	}
}

// TestInsightsTKeyDrillsToLinkedTrace asserts pressing `t` on a
// focused insight emits a NavigateRequest staging the first linked
// trace and jumping to Runs. Per plan S14.
func TestInsightsTKeyDrillsToLinkedTrace(t *testing.T) {
	i := NewInsights()
	i.items = []api.QualityInsightRecord{sampleInsight()}
	i.selectedID = "INS-014"
	i.loaded = true

	cmd := i.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}}, nil)
	if cmd == nil {
		t.Fatal("pressing `t` returned nil; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("got %T, want NavigateRequest", cmd())
	}
	if req.NavID != "runs" || req.Kind != "run" || req.ID != "run-8af2f1c" {
		t.Errorf("NavigateRequest = %+v, want {NavID:runs Kind:run ID:run-8af2f1c}", req)
	}
}

// TestInsightsTKeyNoopWhenNoLinkedTraces asserts `t` is a no-op when
// the focused insight has no linked traces.
func TestInsightsTKeyNoopWhenNoLinkedTraces(t *testing.T) {
	i := NewInsights()
	i.items = []api.QualityInsightRecord{{InsightID: "INS-99"}}
	i.selectedID = "INS-99"
	i.loaded = true

	cmd := i.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}}, nil)
	if cmd != nil {
		t.Errorf("pressing `t` with no linked traces returned non-nil %v; expected no-op", cmd)
	}
}

// TestInsightsExportEmitsCmd asserts `e` returns a non-nil cmd that
// writes the focused insight to ~/.crux/exports/insight-{id}.json.
func TestInsightsExportEmitsCmd(t *testing.T) {
	i := NewInsights()
	i.items = []api.QualityInsightRecord{sampleInsight()}
	i.selectedID = "INS-014"
	i.loaded = true

	cmd := i.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}

// TestInsightsActionStubsEmitCmds asserts the action chords whose
// backends are still gaps return non-nil stub cmds — so the workbench
// can surface "backend pending" toasts via activity feed.
func TestInsightsActionStubsEmitCmds(t *testing.T) {
	cases := []struct {
		name string
		key  rune
	}{
		{"save N cases", 's'},
		{"run variant", 'r'},
		{"compare", 'c'},
		{"promote fix", 'p'},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			i := NewInsights()
			i.items = []api.QualityInsightRecord{sampleInsight()}
			i.selectedID = "INS-014"
			i.loaded = true

			cmd := i.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tc.key}}, nil)
			if cmd == nil {
				t.Errorf("pressing %q returned nil; expected stub cmd", tc.key)
			}
		})
	}
}
