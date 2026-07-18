package evalfs

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestParseRunRejectsMalformedNestedV3Artifacts(t *testing.T) {
	raw, err := os.ReadFile(sharedGoldenPath(t))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(map[string]any)
		want   string
	}{
		{"task", func(run map[string]any) {
			firstCell(run)["task"] = map[string]any{"status": "reused", "reason": "exact_evidence"}
		}, "cells[0].task"},
		{"score", func(run map[string]any) {
			firstCell(run)["scores"] = []any{map[string]any{"status": "computed", "reason": "deterministic_local", "name": "helpful", "contractFingerprint": "local_always_run", "value": 2}}
		}, "cells[0].scores[0]"},
		{"managed score work", func(run map[string]any) {
			firstCell(run)["scores"] = []any{map[string]any{
				"status": "computed", "reason": "managed_external_executed", "name": "judge", "contractFingerprint": "judge-v1", "value": 0.8,
				"work": map[string]any{"status": "executed", "reason": "made_up", "reservation": "consumed"},
			}}
		}, "cells[0].scores[0]"},
		{"unvalidated expected", func(run map[string]any) { firstCell(run)["unvalidatedExpected"] = false }, "cells[0].unvalidatedExpected"},
		{"variant", func(run map[string]any) { run["variants"].([]any)[0].(map[string]any)["blocking"] = "yes" }, "variants"},
		{"aggregate", func(run map[string]any) {
			run["aggregates"].(map[string]any)["current"].(map[string]any)["passRate"] = 2
		}, "aggregates.current"},
		{"gate", func(run map[string]any) {
			run["gates"].(map[string]any)["results"] = []any{map[string]any{"gate": "latency", "variantName": "current", "threshold": []any{}, "actual": 1, "passed": true}}
		}, "gates.results[0]"},
		{"cost", func(run map[string]any) { run["cost"].(map[string]any)["unknownActionCount"] = -1 }, "cost"},
		{"comparison", func(run map[string]any) {
			run["comparison"] = map[string]any{
				"baselineId": "baseline-1", "baselineRunId": "run-1", "selectedArm": "current",
				"cases":          []any{map[string]any{"caseId": "refund", "status": "compatible", "metrics": []any{map[string]any{"name": "helpful", "status": "compatible", "baseline": 0.8, "candidate": 0.9}}}},
				"unmatchedCases": map[string]any{"baselineOnly": []any{}, "candidateOnly": []any{}},
			}
		}, "comparison.cases[0].metrics[0]"},
		{"incomplete reason", func(run map[string]any) {
			run["status"] = "incomplete"
			run["passed"] = false
			run["reasons"] = []any{"made_up"}
		}, "reasons[0]"},
		{"provenance", func(run map[string]any) { run["provenance"].(map[string]any)["host"] = "local" }, "provenance"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var run map[string]any
			if err := json.Unmarshal(raw, &run); err != nil {
				t.Fatal(err)
			}
			test.mutate(run)
			malformed, err := json.Marshal(run)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parseRun(malformed); err == nil || !bytes.Contains([]byte(err.Error()), []byte(test.want)) {
				t.Fatalf("parseRun error = %v, want field %q", err, test.want)
			}
		})
	}
}

func TestParseRunAcceptsUnattestedModelExecutionReason(t *testing.T) {
	raw, err := os.ReadFile(sharedGoldenPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var run map[string]any
	if err := json.Unmarshal(raw, &run); err != nil {
		t.Fatal(err)
	}
	firstCell(run)["task"] = map[string]any{
		"status": "executed",
		"reason": "model_identity_unattested",
	}
	updated, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseRun(updated); err != nil {
		t.Fatalf("parseRun rejected canonical unattested model reason: %v", err)
	}
}

func TestParseRunAcceptsUnresolvedSourceDependencyReason(t *testing.T) {
	raw, err := os.ReadFile(sharedGoldenPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var run map[string]any
	if err := json.Unmarshal(raw, &run); err != nil {
		t.Fatal(err)
	}
	firstCell(run)["task"] = map[string]any{
		"status": "executed",
		"reason": "unresolved_source_dependency",
	}
	updated, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseRun(updated); err != nil {
		t.Fatalf("parseRun rejected canonical source dependency reason: %v", err)
	}
}

func TestParseRunAcceptsUntrackedTaskBindingReason(t *testing.T) {
	raw, err := os.ReadFile(sharedGoldenPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var run map[string]any
	if err := json.Unmarshal(raw, &run); err != nil {
		t.Fatal(err)
	}
	firstCell(run)["task"] = map[string]any{
		"status": "executed",
		"reason": "task_binding_untracked",
	}
	updated, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseRun(updated); err != nil {
		t.Fatalf("parseRun rejected canonical task binding reason: %v", err)
	}
}

func TestParseBaselineRejectsMalformedNestedV3Artifacts(t *testing.T) {
	raw, err := os.ReadFile(sharedBaselinePath(t))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(map[string]any)
		want   string
	}{
		{"source", func(value map[string]any) { value["sourceKey"].(map[string]any)["export"] = "named" }, "sourceKey"},
		{"promotion", func(value map[string]any) { value["promotedAt"] = -1 }, "promotedAt"},
		{"promoted by", func(value map[string]any) { value["promotedBy"] = 42 }, "promotedBy"},
		{"coverage", func(value map[string]any) { value["coverage"].([]any)[0].(map[string]any)["trials"] = []any{-1} }, "coverage[0]"},
		{"metric", func(value map[string]any) {
			value["coverage"].([]any)[0].(map[string]any)["metrics"].(map[string]any)["helpful"].(map[string]any)["aggregation"] = "median"
		}, "coverage[0].metrics.helpful"},
		{"provenance", func(value map[string]any) { delete(value["provenance"].(map[string]any), "taskFingerprint") }, "provenance"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var value map[string]any
			if err := json.Unmarshal(raw, &value); err != nil {
				t.Fatal(err)
			}
			test.mutate(value)
			malformed, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ParseBaseline(malformed); err == nil || !bytes.Contains([]byte(err.Error()), []byte(test.want)) {
				t.Fatalf("ParseBaseline error = %v, want field %q", err, test.want)
			}
		})
	}
}

func firstCell(run map[string]any) map[string]any {
	return run["cells"].([]any)[0].(map[string]any)
}

func TestReadRunPreservesSharedGoldenBytesAndUnknownFields(t *testing.T) {
	fixture := sharedGoldenPath(t)
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	runsDir := filepath.Join(root, ".crux", "evals", "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, "eval-run-golden.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	run, found, err := OpenProject(root).ReadRun("eval-run-golden")
	if err != nil || !found {
		t.Fatalf("ReadRun: found=%v err=%v", found, err)
	}
	if run.SchemaVersion != 3 || run.Status != "complete" || !run.Passed {
		t.Fatalf("unexpected known fields: %+v", run)
	}
	if run.SourceKey.RelativeFile != "support.eval.ts" || run.DefinitionFingerprint != "definition-v1" {
		t.Fatalf("run source identity was not retained: %+v", run)
	}
	if !bytes.Equal(run.Raw, raw) {
		t.Fatal("raw future-additive record changed during read")
	}
	if !bytes.Contains(run.Raw, []byte(`"futureTopLevelField"`)) ||
		!bytes.Contains(run.Raw, []byte(`"futureCellField"`)) {
		t.Fatal("unknown additive fields were not preserved")
	}
}

func TestReadRunRejectsIncompletePassingRecord(t *testing.T) {
	root := t.TempDir()
	runsDir := filepath.Join(root, ".crux", "evals", "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"schemaVersion":3,"runId":"bad","evalId":"support","status":"incomplete","passed":true}`)
	if err := os.WriteFile(filepath.Join(runsDir, "bad.json"), bad, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := OpenProject(root).ReadRun("bad"); err == nil {
		t.Fatal("expected corrupt incomplete run error")
	}
}

func TestParseBaselinePreservesSharedGoldenBytes(t *testing.T) {
	raw, err := os.ReadFile(sharedBaselinePath(t))
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := ParseBaseline(raw)
	if err != nil {
		t.Fatal(err)
	}
	if baseline.BaselineID != "baseline-golden" || !bytes.Equal(raw, baseline.Raw) {
		t.Fatal("Baseline known identity or raw additive bytes changed")
	}
	if !bytes.Contains(baseline.Raw, []byte(`"futureBaselineField"`)) {
		t.Fatal("unknown Baseline field was not preserved")
	}
}

func TestParseBaselineReportsRequiredFingerprintEpoch(t *testing.T) {
	raw, err := os.ReadFile(sharedBaselinePath(t))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	value["baselineFingerprintEpoch"] = 3
	stale, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseBaseline(stale); err == nil || !bytes.Contains([]byte(err.Error()), []byte("fingerprint epoch 4")) {
		t.Fatalf("ParseBaseline error = %v, want fingerprint epoch 4", err)
	}
}

func sharedBaselinePath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(file), "..", "..", "..", "core", "__tests__", "eval",
		"fixtures", "baseline-v3.golden.json",
	))
}

func sharedGoldenPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(file), "..", "..", "..", "core", "__tests__", "eval",
		"fixtures", "run-v3.golden.json",
	))
}
