package endpoints

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

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
	baseline := json.RawMessage(`{"schemaVersion":3,"evalId":"support","compatibility":{"status":"compatible"}}`)
	manifest := json.RawMessage(`{"id":"support","sourceKey":{"relativeFile":"evals/support.eval.ts"},"cases":[{"id":"refund"}]}`)
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
	gotBaseline, err := EvalBaseline.Call(context.Background(), deps, &readmodel.PathID{ID: "support"})
	if err != nil || string(gotBaseline) != string(baseline) {
		t.Fatalf("EvalBaseline = %s, err = %v", gotBaseline, err)
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
