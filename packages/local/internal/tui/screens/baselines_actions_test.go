package screens

import (
	"context"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func sampleBaseline() api.QualityPromotedBaseline {
	return api.QualityPromotedBaseline{
		BaselineID:        "baseline-014",
		EvaluationID:      "agent-loops",
		ExperimentID:      "exp-043",
		VariantName:       "maxIter+dedupe",
		PromotedAt:        "2026-07-02T10:00:00Z",
		ConfigFingerprint: "cfg-123",
		Reference: map[string]map[string]float64{
			"case-001": {"pass": 0.97},
		},
	}
}

func TestBaselinesOpenExperimentUsesOKey(t *testing.T) {
	screen := NewBaselines()
	screen.items = []api.QualityPromotedBaseline{sampleBaseline()}
	screen.selectedID = "baseline-014"
	screen.loaded = true

	cmd := screen.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}), nil)
	if cmd == nil {
		t.Fatal("o returned nil; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("o returned %T, want NavigateRequest", cmd())
	}
	if req.NavID != "experiments" || req.Kind != "experiment" || req.ID != "exp-043" {
		t.Fatalf("NavigateRequest = %+v, want experiments/experiment/exp-043", req)
	}
}

func TestBaselinesReplaceUsesPromoteBaselinePin(t *testing.T) {
	client := &baselineReplaceClient{FixtureClient: uitest.NewFixtureClient()}
	screen := NewBaselines()
	screen.items = []api.QualityPromotedBaseline{sampleBaseline()}
	screen.selectedID = "baseline-014"
	screen.loaded = true

	cmd := screen.Update(tea.KeyPressMsg(tea.Key{Text: "R", Code: 'R'}), client)
	if cmd == nil {
		t.Fatal("R returned nil; expected replace command")
	}
	if _, ok := cmd().(baselineReplacedMsg); !ok {
		t.Fatalf("R returned %T, want baselineReplacedMsg", cmd())
	}
	if client.experimentID != "exp-043" || client.variant != "maxIter+dedupe" || client.pinID != "baseline-014" {
		t.Fatalf("replace args = %q/%q/%q", client.experimentID, client.variant, client.pinID)
	}
}

func TestBaselinesKeybindsHideDeferredCompare(t *testing.T) {
	screen := NewBaselines()
	binds := make([]string, 0, len(screen.Keybinds()))
	for _, bind := range screen.Keybinds() {
		binds = append(binds, bind.Key+" "+bind.Label)
	}
	text := strings.Join(binds, " · ")
	if strings.Contains(text, "c compare") {
		t.Fatalf("Compare is deferred but Baselines advertises it: %s", text)
	}
	for _, want := range []string{"o open experiment", "R replace"} {
		if !strings.Contains(text, want) {
			t.Fatalf("Baselines keybinds missing %q: %s", want, text)
		}
	}
}

type baselineReplaceClient struct {
	*uitest.FixtureClient
	experimentID string
	variant      string
	pinID        string
}

func (c *baselineReplaceClient) PromoteBaseline(_ context.Context, experimentID, variant, pinID string) (api.QualityPromoteResult, error) {
	c.experimentID = experimentID
	c.variant = variant
	c.pinID = pinID
	return api.QualityPromoteResult{
		BaselineID:   pinID,
		EvaluationID: "agent-loops",
		ExperimentID: experimentID,
		VariantName:  variant,
		Path:         ".crux/quality/baselines/agent-loops.json",
	}, nil
}
