package screens

import (
	"context"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
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

	cmd := i.Update(tea.KeyPressMsg(tea.Key{Text: "t", Code: 't'}), nil)
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

	cmd := i.Update(tea.KeyPressMsg(tea.Key{Text: "t", Code: 't'}), nil)
	if cmd != nil {
		t.Errorf("pressing `t` with no linked traces returned non-nil %v; expected no-op", cmd)
	}
}

func TestInsightsBracketKeysSwitchTabs(t *testing.T) {
	i := NewInsights()
	i.items = []api.QualityInsightRecord{sampleInsight()}
	i.selectedID = "INS-014"
	i.loaded = true

	i.Update(tea.KeyPressMsg(tea.Key{Text: "]", Code: ']'}), nil)
	if i.tab != "traces" {
		t.Fatalf("] should advance to traces tab, got %q", i.tab)
	}

	i.Update(tea.KeyPressMsg(tea.Key{Text: "[", Code: '['}), nil)
	if i.tab != "diagnosis" {
		t.Fatalf("[ should return to diagnosis tab, got %q", i.tab)
	}
}

// TestInsightsExportEmitsCmd asserts `e` returns a non-nil cmd that
// writes the focused insight to ~/.crux/exports/insight-{id}.json.
func TestInsightsExportEmitsCmd(t *testing.T) {
	i := NewInsights()
	i.items = []api.QualityInsightRecord{sampleInsight()}
	i.selectedID = "INS-014"
	i.loaded = true

	cmd := i.Update(tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}

// TestInsightsUnsupportedActionsDoNotEmitStubs asserts action chords whose
// backend write surfaces are missing do not fabricate placeholder commands.
func TestInsightsUnsupportedActionsDoNotEmitStubs(t *testing.T) {
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

			cmd := i.Update(tea.KeyPressMsg(tea.Key{Text: string(tc.key), Code: tc.key}), nil)
			if cmd != nil {
				t.Errorf("pressing %q returned a stub command; missing backend actions must stay blocked", tc.key)
			}
		})
	}
}

func TestInsightsPromoteUsesLinkedExperimentWinner(t *testing.T) {
	client := &insightPromoteClient{FixtureClient: uitest.NewFixtureClient()}
	i := NewInsights()
	insight := sampleInsight()
	insight.LinkedExperimentIDs = []string{"exp-043"}
	i.items = []api.QualityInsightRecord{insight}
	i.selectedID = "INS-014"
	i.loaded = true

	cmd := i.Update(tea.KeyPressMsg(tea.Key{Text: "p", Code: 'p'}), client)
	if cmd == nil {
		t.Fatal("p returned nil; expected promote command")
	}
	if _, ok := cmd().(insightPromotedMsg); !ok {
		t.Fatalf("p returned %T, want insightPromotedMsg", cmd())
	}
	if client.gotExperimentID != "exp-043" || client.gotVariant != "maxIter+dedupe" {
		t.Fatalf("promote args = %q/%q, want exp-043/maxIter+dedupe", client.gotExperimentID, client.gotVariant)
	}
}

func TestInsightsKeybindsOnlyAdvertiseWiredActions(t *testing.T) {
	i := NewInsights()
	got := make([]string, 0)
	for _, bind := range i.Keybinds() {
		got = append(got, bind.Key+" "+bind.Label)
	}
	text := strings.Join(got, " · ")
	for _, want := range []string{"t linked traces", "x dismiss"} {
		if !strings.Contains(text, want) {
			t.Fatalf("keybinds missing wired action %q: %s", want, text)
		}
	}
	for _, blocked := range []string{"s save cases", "r run variant", "c compare", "p promote fix"} {
		if strings.Contains(text, blocked) {
			t.Fatalf("keybinds advertised blocked action %q: %s", blocked, text)
		}
	}
}

func TestInsightsKeybindsAdvertisePromoteForLinkedExperiment(t *testing.T) {
	i := NewInsights()
	insight := sampleInsight()
	insight.LinkedExperimentIDs = []string{"exp-043"}
	i.items = []api.QualityInsightRecord{insight}
	i.selectedID = "INS-014"
	i.loaded = true

	got := make([]string, 0)
	for _, bind := range i.Keybinds() {
		got = append(got, bind.Key+" "+bind.Label)
	}
	text := strings.Join(got, " · ")
	if !strings.Contains(text, "p promote") {
		t.Fatalf("keybinds missing linked-experiment promote action: %s", text)
	}
}

type insightPromoteClient struct {
	*uitest.FixtureClient
	gotExperimentID string
	gotVariant      string
}

func (c *insightPromoteClient) PromoteBaseline(_ context.Context, experimentID, variant, _ string) (api.QualityPromoteResult, error) {
	c.gotExperimentID = experimentID
	c.gotVariant = variant
	return api.QualityPromoteResult{
		BaselineID:   "baseline-015",
		EvaluationID: "agent-loops",
		ExperimentID: experimentID,
		VariantName:  variant,
		Path:         ".crux/quality/baselines/agent-loops.json",
	}, nil
}
