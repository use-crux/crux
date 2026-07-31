package devtools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type directEvalReads struct {
	runs      []json.RawMessage
	baselines []json.RawMessage
}

func (f directEvalReads) ListRuns() ([]json.RawMessage, error) { return f.runs, nil }

func (f directEvalReads) ReadRunRaw(id string) (json.RawMessage, bool, error) {
	for _, run := range f.runs {
		var identity struct {
			RunID string `json:"runId"`
		}
		_ = json.Unmarshal(run, &identity)
		if identity.RunID == id {
			return run, true, nil
		}
	}
	return nil, false, nil
}

func (f directEvalReads) ListBaselines() ([]json.RawMessage, error) {
	return f.baselines, nil
}

func (f directEvalReads) ReadBaselineRaw(string) (json.RawMessage, bool, error) {
	return nil, false, nil
}

type directEvalCatalog struct {
	manifests []json.RawMessage
}

func (f directEvalCatalog) EvalManifests(context.Context) ([]json.RawMessage, error) {
	return f.manifests, nil
}

func TestDirectClientEvalReadsUseTypedEndpoints(t *testing.T) {
	ctx := context.Background()
	run := json.RawMessage(`{"schemaVersion":4,"runId":"eval-run-1","evalId":"support"}`)
	baseline := json.RawMessage(`{"schemaVersion":3,"baselineId":"baseline-1","evalId":"support"}`)
	manifest := json.RawMessage(`{"id":"support","baselineCompatibility":{"status":"incompatible","reason":"expected_changed","cases":[]}}`)
	client := NewDirectClientFromService(NewService(store.NewStore(), nil)).WithEvalReads(
		directEvalReads{runs: []json.RawMessage{run}, baselines: []json.RawMessage{baseline}},
		directEvalCatalog{manifests: []json.RawMessage{manifest}},
	)

	catalog, err := client.EvalCatalog(ctx)
	if err != nil || len(catalog) != 1 || string(catalog[0]) != string(manifest) {
		t.Fatalf("EvalCatalog = %s, err = %v", catalog, err)
	}
	runs, err := client.EvalRuns(ctx)
	if err != nil || len(runs) != 1 || string(runs[0]) != string(run) {
		t.Fatalf("EvalRuns = %s, err = %v", runs, err)
	}
	got, err := client.EvalRun(ctx, "eval-run-1")
	if err != nil || string(got) != string(run) {
		t.Fatalf("EvalRun = %s, err = %v", got, err)
	}
	if _, err := client.EvalRun(ctx, "missing"); err != readmodel.ErrNotFound {
		t.Fatalf("EvalRun missing error = %v, want ErrNotFound", err)
	}
	baselines, err := client.EvalBaselines(ctx)
	if err != nil || len(baselines) != 1 {
		t.Fatalf("EvalBaselines = %s, err = %v", baselines, err)
	}
	if !strings.Contains(string(baselines[0]), `"baselineCompatibility":{"status":"incompatible"`) {
		t.Fatalf("EvalBaselines = %s, want attached compatibility", baselines)
	}
}
