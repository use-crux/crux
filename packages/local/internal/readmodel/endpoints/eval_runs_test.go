package endpoints

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

type fakeEvalReads struct {
	runs []json.RawMessage
}

func (f fakeEvalReads) ListRuns() ([]json.RawMessage, error) {
	return f.runs, nil
}

func (f fakeEvalReads) ReadRunRaw(id string) (json.RawMessage, bool, error) {
	if id != "eval-run-1" {
		return nil, false, nil
	}
	return f.runs[0], true, nil
}

func TestEvalRunEndpointsServeRawV3Records(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"runId":"eval-run-1","future":true}`)
	deps := Deps{Eval: fakeEvalReads{runs: []json.RawMessage{raw}}}

	list, err := EvalRuns.Call(context.Background(), deps)
	if err != nil || len(list) != 1 || string(list[0]) != string(raw) {
		t.Fatalf("EvalRuns: records=%s err=%v", list, err)
	}
	record, err := EvalRun.Call(
		context.Background(), deps, &readmodel.PathID{ID: "eval-run-1"},
	)
	if err != nil || string(record) != string(raw) {
		t.Fatalf("EvalRun: record=%s err=%v", record, err)
	}
	if _, err := EvalRun.Call(
		context.Background(), deps, &readmodel.PathID{ID: "missing"},
	); err == nil {
		t.Fatal("missing Eval run must surface ErrNotFound")
	}
}
