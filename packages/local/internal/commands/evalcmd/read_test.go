package evalcmd

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestSavedRunAndDiffUseHumanReadableEvidenceProjection(t *testing.T) {
	a := json.RawMessage(`{"schemaVersion":3,"runId":"run-a","evalId":"support","status":"complete","passed":true,"startedAt":1,"endedAt":51,"selection":{},"aggregates":{"current":{"passRate":1,"latencyMs":40,"knownCostUsd":0.01,"scores":{"helpful":{"mean":0.9}}}},"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"executed","reason":"no_exact_evidence"},"scores":[{"status":"computed","reason":"deterministic_local","name":"helpful","value":0.9}],"assertions":{"ran":1,"notEvaluated":0,"outcomes":[{"status":"passed"}]},"metrics":{"durationMs":40,"costUsd":0.01},"runIds":["generation-a"]}]}`)
	b := json.RawMessage(`{"schemaVersion":3,"runId":"run-b","evalId":"support","status":"complete","passed":false,"startedAt":2,"endedAt":72,"selection":{},"aggregates":{"current":{"passRate":0,"latencyMs":55,"knownCostUsd":0.02,"scores":{"helpful":{"mean":0.4}}}},"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"failed","task":{"status":"reused","reason":"exact_evidence"},"scores":[{"status":"computed","reason":"deterministic_local","name":"helpful","value":0.4}],"assertions":{"ran":1,"notEvaluated":0,"outcomes":[{"status":"failed","message":"wrong answer"}]},"metrics":{"durationMs":55,"costUsd":0.02},"runIds":["generation-b"]}]}`)

	var out bytes.Buffer
	if err := renderSavedRun(&out, a); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"support", "run-a", "refund/current", "helpful=0.9", "generation-a", "40ms", "$0.010000"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("show output missing %q:\n%s", want, out.String())
		}
	}

	out.Reset()
	if err := renderRunDiff(&out, a, b); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"run-a → run-b", "pass rate -100.0pp", "latency +15ms", "cost +$0.010000", "helpful -0.5", "refund/current/trial-1: passed → failed"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("diff output missing %q:\n%s", want, out.String())
		}
	}
}

func TestSavedRunUsesCanonicalScoreAndAssertionStatusAndKeepsTrialsDistinct(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":3,"runId":"run-a","evalId":"support","status":"complete","passed":false,"cells":[{"caseId":"refund","variant":"current","trial":0,"status":"passed","task":{"status":"reused","reason":"exact_evidence"},"scores":[{"status":"reused","reason":"managed_external_reused","name":"helpful","value":0.9}],"assertions":{"ran":1,"outcomes":[{"status":"passed"}]},"metrics":{"durationMs":10}},{"caseId":"refund","variant":"current","trial":1,"status":"failed","task":{"status":"executed","reason":"no_exact_evidence"},"scores":[{"status":"errored","reason":"scorer_error","name":"helpful","message":"judge unavailable"}],"assertions":{"ran":1,"outcomes":[{"status":"failed","message":"wrong answer"}]},"metrics":{"durationMs":11}}]}`)
	var out bytes.Buffer
	if err := renderSavedRun(&out, raw); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"refund/current/trial-1", "refund/current/trial-2", "helpful=0.9 [reused]",
		"helpful errored (scorer_error: judge unavailable)", "wrong answer",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("show output missing %q:\n%s", want, out.String())
		}
	}
}
