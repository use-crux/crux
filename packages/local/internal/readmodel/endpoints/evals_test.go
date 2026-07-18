package endpoints

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/evalfs"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

func TestEvalRunsRejectsMalformedNestedArtifactsBeforeAPI(t *testing.T) {
	root := t.TempDir()
	runsDir := filepath.Join(root, ".crux", "evals", "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	malformed := []byte(`{"schemaVersion":3,"runId":"bad","evalId":"support","sourceKey":{"relativeFile":"support.eval.ts","export":"default"},"startedAt":0,"endedAt":1,"definitionFingerprint":"v1","selection":{"cases":[],"variants":[],"trials":1,"caseTrials":{}},"costControl":"not_required","blockingVariants":[],"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"impossible","reason":"no_exact_evidence"},"scores":[],"assertions":{"ran":0,"notEvaluated":0,"outcomes":[]},"input":{},"metrics":{"durationMs":1},"runIds":[],"capturedSignals":[]}],"variants":[],"aggregates":{},"gates":{"passed":true,"blockingPassed":true,"results":[]},"cost":{"reservedMaximumUsd":0,"unknownActionCount":0,"task":{},"judge":{}},"provenance":{"task":"managed","host":"injected","evidenceStore":"none"},"status":"complete","passed":true}`)
	if err := os.WriteFile(filepath.Join(runsDir, "bad.json"), malformed, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := EvalRuns.Call(context.Background(), Deps{Eval: evalfs.OpenProject(root)})
	if err == nil || !strings.Contains(err.Error(), "cells[0].task") {
		t.Fatalf("EvalRuns error = %v", err)
	}
}

type fakeEvalReads struct {
	runs      []json.RawMessage
	baselines []json.RawMessage
}

func (f fakeEvalReads) ListRuns() ([]json.RawMessage, error) { return f.runs, nil }
func (f fakeEvalReads) ReadRunRaw(id string) (json.RawMessage, bool, error) {
	return findRaw(f.runs, id, "runId")
}
func (f fakeEvalReads) ListBaselines() ([]json.RawMessage, error) { return f.baselines, nil }
func (f fakeEvalReads) ReadBaselineRaw(id string) (json.RawMessage, bool, error) {
	return findRaw(f.baselines, id, "evalId")
}

type fakeEvalCatalog struct{ manifests []json.RawMessage }

func (f fakeEvalCatalog) EvalManifests(context.Context) ([]json.RawMessage, error) {
	return f.manifests, nil
}

func TestEvalEndpointsServeCatalogRunsAndBaselinesWithoutLegacyVocabulary(t *testing.T) {
	run := json.RawMessage(`{"schemaVersion":3,"runId":"eval-run-1","future":true}`)
	baseline := json.RawMessage(`{"schemaVersion":3,"evalId":"support"}`)
	manifest := json.RawMessage(`{"id":"support","sourceKey":{"relativeFile":"evals/support.eval.ts"},"cases":[{"id":"refund"}],"baselineCompatibility":{"status":"incompatible","reason":"case_coverage_changed","cases":[{"caseId":"refund","status":"missing","reason":"current_case_missing","metrics":[]}]}}`)
	deps := Deps{
		Eval:        fakeEvalReads{runs: []json.RawMessage{run}, baselines: []json.RawMessage{baseline}},
		EvalCatalog: fakeEvalCatalog{manifests: []json.RawMessage{manifest}},
	}

	catalog, err := EvalCatalog.Call(context.Background(), deps)
	if err != nil || len(catalog) != 1 || string(catalog[0]) != string(manifest) {
		t.Fatalf("EvalCatalog = %s, err = %v", catalog, err)
	}
	runs, err := EvalRuns.Call(context.Background(), deps)
	if err != nil || len(runs) != 1 || string(runs[0]) != string(run) {
		t.Fatalf("EvalRuns = %s, err = %v", runs, err)
	}
	gotRun, err := EvalRun.Call(context.Background(), deps, &readmodel.PathID{ID: "eval-run-1"})
	if err != nil || string(gotRun) != string(run) {
		t.Fatalf("EvalRun = %s, err = %v", gotRun, err)
	}
	baselines, err := EvalBaselines.Call(context.Background(), deps)
	if err != nil || len(baselines) != 1 {
		t.Fatalf("EvalBaselines = %s, err = %v", baselines, err)
	}
	if !jsonContains(baselines[0], `"baselineCompatibility":{"status":"incompatible"`) {
		t.Fatalf("EvalBaselines lacks current compatibility: %s", baselines[0])
	}
	gotBaseline, err := EvalBaseline.Call(context.Background(), deps, &readmodel.PathID{ID: "support"})
	if err != nil || !jsonContains(gotBaseline, `"baselineCompatibility":{"status":"incompatible"`) {
		t.Fatalf("EvalBaseline = %s, err = %v", gotBaseline, err)
	}
}

func jsonContains(value json.RawMessage, fragment string) bool {
	return strings.Contains(string(value), fragment)
}

func TestEvalRegistryDoesNotExposeRemovedRunEndpoints(t *testing.T) {
	removed := map[string]bool{
		"GET /api/flows":          true,
		"GET /api/flows/{flowId}": true,
	}
	for _, endpoint := range Registry.Endpoints() {
		if removed[endpoint.Pattern()] {
			t.Fatalf("removed endpoint %q is still registered", endpoint.Pattern())
		}
	}
}

func findRaw(records []json.RawMessage, id, field string) (json.RawMessage, bool, error) {
	for _, record := range records {
		var value map[string]json.RawMessage
		_ = json.Unmarshal(record, &value)
		var candidate string
		_ = json.Unmarshal(value[field], &candidate)
		if candidate == id {
			return record, true, nil
		}
	}
	return nil, false, nil
}
