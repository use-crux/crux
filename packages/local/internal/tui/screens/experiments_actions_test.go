package screens

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestExperimentsEnterOpensFocusedFailureRun(t *testing.T) {
	screen, _ := fixtureExperiments(t)
	screen.focus = expFocusDetail

	cmd := screen.Update(tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter}), nil)
	if cmd == nil {
		t.Fatal("Enter returned nil; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("Enter returned %T, want NavigateRequest", cmd())
	}
	if req.NavID != "runs" || req.Kind != "run" || req.ID != "8af2f1c" {
		t.Fatalf("NavigateRequest = %+v, want runs/run/8af2f1c", req)
	}
}

func TestExperimentsPromoteUsesWinnerVariant(t *testing.T) {
	client := &experimentPromoteClient{FixtureClient: uitest.NewFixtureClient()}
	screen, _ := fixtureExperiments(t)

	cmd := screen.Update(tea.KeyPressMsg(tea.Key{Text: "p", Code: 'p'}), client)
	if cmd == nil {
		t.Fatal("p returned nil; expected promote command")
	}
	if _, ok := cmd().(experimentPromotedMsg); !ok {
		t.Fatalf("p returned %T, want experimentPromotedMsg", cmd())
	}
	if client.gotExperimentID != "exp-043" || client.gotVariant != "maxIter+dedupe" {
		t.Fatalf("promote args = %q/%q, want exp-043/maxIter+dedupe", client.gotExperimentID, client.gotVariant)
	}
}

func TestExperimentsExportWritesCSV(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	screen, _ := fixtureExperiments(t)

	cmd := screen.Update(tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd == nil {
		t.Fatal("e returned nil; expected export command")
	}
	msg, ok := cmd().(experimentExportedMsg)
	if !ok {
		t.Fatalf("e returned %T, want experimentExportedMsg", cmd())
	}
	if msg.experimentID != "exp-043" {
		t.Fatalf("exported experiment = %q, want exp-043", msg.experimentID)
	}
	path := filepath.Join(home, ".crux", "exports", "experiment-exp-043.csv")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, want := range []string{
		"experiment_id,evaluation_id,variant,cells,passed,failed,pass_rate,score_mean,latency_p95_ms,cost_usd",
		"exp-043,agent-loops,maxIter+dedupe,4,4,0,0.9700,0.8200,4100.0,0.4900",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("CSV export missing %q:\n%s", want, text)
		}
	}
}

func TestExperimentsUnsupportedActionsDoNotEmitStubs(t *testing.T) {
	cases := []struct {
		name string
		key  rune
	}{
		{"compare selected variants", 'c'},
		{"re-run experiment", 'r'},
		{"new experiment", 'n'},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			screen, _ := fixtureExperiments(t)
			cmd := screen.Update(tea.KeyPressMsg(tea.Key{Text: string(tc.key), Code: tc.key}), nil)
			if cmd != nil {
				t.Fatalf("pressing %q returned a command; missing experiment action surfaces must stay hidden", tc.key)
			}
		})
	}
}

type experimentPromoteClient struct {
	*uitest.FixtureClient
	gotExperimentID string
	gotVariant      string
}

func (c *experimentPromoteClient) PromoteBaseline(_ context.Context, experimentID, variant, _ string) (api.QualityPromoteResult, error) {
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
