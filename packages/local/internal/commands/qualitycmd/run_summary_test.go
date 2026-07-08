package qualitycmd

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestQualityRunSummaryObjectUsesReporterState(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	reporter := newQualityReporter(&qualityRunOpts{}, io, 4400)

	failing := domain.QualityCell{
		CaseID:      "refund-policy",
		CaseName:    "refund policy",
		VariantName: "candidate",
		Trial:       0,
		Status:      "failed",
		DurationMs:  1250,
		CostUsd:     0.12,
	}
	failing.Assertions.Outcomes = []domain.QualityAssertionOutcome{{
		Status:  "failed",
		Phase:   "expect",
		Matcher: "toContain",
		Message: "expected refund window",
	}}

	reporter.handle(&domain.QualityEvent{Type: "eval:start", RunID: "01KTRUNSUMMARY", EvaluationID: "support.refunds", Cells: 2})
	reporter.handle(&domain.QualityEvent{Type: "cell:done", RunID: "01KTRUNSUMMARY", EvaluationID: "support.refunds", Cell: &domain.QualityCell{
		CaseID: "happy-path", VariantName: "candidate", Trial: 0, Status: "passed", DurationMs: 750, CostUsd: 0.03,
	}})
	reporter.handle(&domain.QualityEvent{Type: "cell:done", RunID: "01KTRUNSUMMARY", EvaluationID: "support.refunds", Cell: &failing})
	reporter.handle(&domain.QualityEvent{
		Type:         "eval:done",
		RunID:        "01KTRUNSUMMARY",
		EvaluationID: "support.refunds",
		ExperimentID: "01KTEXPERIMENT",
		RecordPath:   ".crux/quality/experiments/01KTEXPERIMENT.json",
		Aggregates:   &domain.QualityAggregates{PerVariant: map[string]domain.QualityVariantAggregate{"candidate": variantAgg(1, 1, 0, 0, 0.5)}},
		Gates:        &domain.QualityGates{Passed: false, Results: []domain.QualityGateResult{{Gate: "pass_rate.min", Passed: false}}},
		FilteredRun:  false,
		BaselineRef:  &domain.QualityBaselineRef{ExperimentID: "01KTBASELINE", VariantName: "default"},
	})

	summary := buildQualityRunSummary(reporter, 1, nil)
	data, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("summary must marshal to JSON: %v\n%s", err, data)
	}
	if decoded["schemaVersion"] != float64(1) || decoded["runId"] != "01KTRUNSUMMARY" || decoded["exitCode"] != float64(1) {
		t.Fatalf("summary identity = %+v", decoded)
	}
	evaluations := decoded["evaluations"].([]any)
	first := evaluations[0].(map[string]any)
	if first["id"] != "support.refunds" || first["experimentId"] != "01KTEXPERIMENT" || first["passed"] != false {
		t.Fatalf("evaluation summary = %+v", first)
	}
	failures := first["failures"].([]any)
	failure := failures[0].(map[string]any)
	if failure["summary"] != "expected refund window" {
		t.Fatalf("failure summary = %+v", failure)
	}
	evidence := failure["evidence"].(map[string]any)
	if got := evidence["cellEvidenceCommand"].(string); !strings.Contains(got, "crux quality cell-evidence 01KTEXPERIMENT --case refund-policy --variant candidate --trial 0 --json") {
		t.Fatalf("evidence command = %q", got)
	}
	if summary.Summary == "" || !strings.Contains(summary.Summary, "support.refunds regressed") {
		t.Fatalf("plain summary = %q", summary.Summary)
	}
}

func TestJSONStdoutModeSuppressesHumanReporterOutput(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	reporter := newQualityReporter(&qualityRunOpts{jsonStdout: true}, io, 4400)

	reporter.handle(&domain.QualityEvent{Type: "eval:start", RunID: "01KTSILENT", EvaluationID: "eval.silent", Cells: 1})
	reporter.handle(&domain.QualityEvent{
		Type:         "eval:done",
		RunID:        "01KTSILENT",
		EvaluationID: "eval.silent",
		ExperimentID: "01KTSILENTEXP",
		Aggregates:   &domain.QualityAggregates{PerVariant: map[string]domain.QualityVariantAggregate{"default": variantAgg(1, 0, 0, 0, 1)}},
		Gates:        &domain.QualityGates{Passed: true},
	})
	reporter.banner(0)

	if out.String() != "" || errBuf.String() != "" {
		t.Fatalf("--json reporter should be silent before final JSON, stdout=%q stderr=%q", out.String(), errBuf.String())
	}
	if summary := buildQualityRunSummary(reporter, 0, nil); summary.RunID != "01KTSILENT" || len(summary.Evaluations) != 1 {
		t.Fatalf("reporter lost machine state under --json: %+v", summary)
	}
}
