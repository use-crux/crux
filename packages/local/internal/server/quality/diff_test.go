package quality

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	qualitysvc "github.com/use-crux/crux/packages/local/internal/quality"
)

func TestParseDiffOutcome(t *testing.T) {
	stdout := []byte(`{"type":"diff:done","diff":{"schemaVersion":1,"a":{"experimentId":"01KTA"},"b":{"experimentId":"01KTB"},"comparable":false,"fingerprintDrift":["dataset"],"scores":[],"cases":[],"onlyInA":[],"onlyInB":[],"gatesVerdict":{"aPassed":true,"bPassed":false}}}
{"type":"run:done","exitCode":0}
`)
	diff, found, err := parseDiffOutcome(stdout)
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	var probe struct {
		SchemaVersion    int      `json:"schemaVersion"`
		Comparable       bool     `json:"comparable"`
		FingerprintDrift []string `json:"fingerprintDrift"`
	}
	if err := json.Unmarshal(diff, &probe); err != nil {
		t.Fatal(err)
	}
	if probe.SchemaVersion != 1 || probe.Comparable || len(probe.FingerprintDrift) != 1 {
		t.Fatalf("diff not verbatim: %s", diff)
	}
}

func TestParseDiffOutcomeSurfacesError(t *testing.T) {
	stdout := []byte(`{"type":"error","message":"record not found"}` + "\n")
	if _, found, err := parseDiffOutcome(stdout); err == nil || found {
		t.Fatalf("error event must surface: found=%v err=%v", found, err)
	}
}

func TestDiffHandlerReturnsDiffJSONAndActivity(t *testing.T) {
	dir := t.TempDir()
	events := qualitysvc.NewEventBus(dir)

	var gotA, gotB string
	runDiff := func(_ context.Context, aPath, bPath string) (json.RawMessage, error) {
		gotA, gotB = aPath, bPath
		return json.RawMessage(`{"schemaVersion":1,"a":{"experimentId":"01KTA"},"b":{"experimentId":"01KTB"},"comparable":true,"fingerprintDrift":[],"scores":[],"cases":[],"onlyInA":[],"onlyInB":[],"gatesVerdict":{"aPassed":true,"bPassed":false}}`), nil
	}
	resolvePath := func(id string) string { return "/records/" + id + ".json" }

	mux := http.NewServeMux()
	registerDiffHandler(mux, resolvePath, runDiff, events)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/experiments/diff?a=01KTA&b=01KTB")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var diff struct {
		A struct {
			ExperimentID string `json:"experimentId"`
		} `json:"a"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&diff); err != nil {
		t.Fatal(err)
	}
	if diff.A.ExperimentID != "01KTA" {
		t.Fatalf("diff payload = %+v", diff)
	}
	if gotA != "/records/01KTA.json" || gotB != "/records/01KTB.json" {
		t.Fatalf("resolved paths a=%q b=%q", gotA, gotB)
	}
	activity := events.RecentActivity(10)
	if len(activity) != 1 || activity[0].Kind != "diff" || activity[0].RefID != "01KTA..01KTB" {
		t.Fatalf("diff activity = %+v", activity)
	}
}

func TestDiffHandlerRequiresBothParams(t *testing.T) {
	mux := http.NewServeMux()
	registerDiffHandler(mux, func(id string) string { return id }, func(context.Context, string, string) (json.RawMessage, error) {
		t.Fatal("runDiff must not run without both params")
		return nil, nil
	}, nil)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/experiments/diff?a=01KTA")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
