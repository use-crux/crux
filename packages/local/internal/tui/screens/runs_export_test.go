package screens

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type preservingRunDetailClient struct {
	*uitest.FixtureClient
	detail api.ObservabilityRunDetail
}

func (c *preservingRunDetailClient) ObservabilityRunDetail(context.Context, string) (api.ObservabilityRunDetail, bool, error) {
	return c.detail, true, nil
}

// TestRunsExportEmitsCmd asserts pressing `e` with a selected run
// returns a non-nil tea.Cmd — the cmd writes the run's JSON to
// ~/.crux/exports/run-{id}.json and emits an `exportSavedMsg`. The
// actual file IO is exercised via the cmd; the screen-level behavior
// under test is "produces a cmd."
func TestRunsExportEmitsCmd(t *testing.T) {
	r := NewRuns()
	r.selRun = "8af2f1c"
	setRunDetailForTest(r, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "8af2f1c"},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})

	cmd := r.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil cmd; expected export emitter")
	}
}

// TestRunsExportWithoutSelectionIsNoop asserts pressing `e` with no
// run loaded does nothing (returns nil) so the user doesn't see a
// surprise file appear.
func TestRunsExportWithoutSelectionIsNoop(t *testing.T) {
	r := NewRuns()
	// No detail, no selRun.

	cmd := r.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd != nil {
		t.Errorf("pressing `e` without a run returned non-nil cmd %v", cmd)
	}
}

func TestRunsExportPreservesCompleteObservabilityDetail(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	detail := api.ObservabilityRunDetail{
		SchemaVersion: 3,
		Run:           api.ObservabilityRunSummary{RunID: "run-preserved", Revision: 71},
		Root:          api.ObservabilityRunDetailNode{ID: "root"},
		Rows: []api.ObservabilityRunDetailRow{
			{NodeID: "root", SpanID: "span-root", Depth: 2},
		},
		Diagnostics: []observability.RunDetailDiagnostic{
			{Code: "run.gap", Severity: "warning", Message: "preserve me"},
		},
		DefinitionRefs: []observability.DefinitionRef{
			{ID: "agent:docs", Kind: "agent", Role: "invoked"},
		},
		Debug: &api.ObservabilityGraph{
			Run:     api.ObservabilityRunSummary{RunID: "run-preserved"},
			Records: []api.ObservabilityStoredRecord{{RecordID: "record-1"}},
		},
	}
	client := &preservingRunDetailClient{FixtureClient: uitest.NewFixtureClient(), detail: detail}
	runs := NewRuns()
	runs.selRun = detail.Run.RunID
	cmd := runs.fetchRunDetail(testContext, client, detail.Run.RunID)
	runs.Update(testContext, cmd(), client)

	export := runs.exportRun()
	if export == nil {
		t.Fatal("lossless detail did not enable export")
	}
	msg := export()
	exported, ok := msg.(runExportedMsg)
	if !ok {
		t.Fatal("export returned no completion message")
	}
	wantDir := filepath.Join(home, ".crux", "exports")
	if filepath.Dir(exported.path) != wantDir {
		t.Fatalf("export directory = %q, want %q", filepath.Dir(exported.path), wantDir)
	}
	body, err := os.ReadFile(exported.path)
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	var got api.ObservabilityRunDetail
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(got.Rows) != 1 || got.Rows[0].SpanID != "span-root" {
		t.Fatalf("exported rows = %#v, want source rows", got.Rows)
	}
	if len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "run.gap" {
		t.Fatalf("exported diagnostics = %#v, want source diagnostics", got.Diagnostics)
	}
	if len(got.DefinitionRefs) != 1 || got.DefinitionRefs[0].ID != "agent:docs" {
		t.Fatalf("exported definition refs = %#v, want source refs", got.DefinitionRefs)
	}
	if got.Debug == nil || len(got.Debug.Records) != 1 {
		t.Fatalf("exported debug graph = %#v, want source debug graph", got.Debug)
	}
}
