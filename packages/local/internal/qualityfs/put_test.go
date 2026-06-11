package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPutNormalizesAndSnapshotsRecordKinds(t *testing.T) {
	fs := Open(t.TempDir())

	suite, err := Put(fs, Suite{
		ID: "Suite:One",
		Cases: []SuiteCase{
			{ID: "Case:One"},
		},
	})
	if err != nil {
		t.Fatalf("put suite: %v", err)
	}
	if suite.SuiteID != "Suite:One" || suite.ID != "" || suite.Tag != "QualitySuite" {
		t.Fatalf("suite normalization = %#v", suite)
	}
	if suite.Source != "json" || suite.State != "pinned" || suite.CaseCount != 1 {
		t.Fatalf("suite defaults = %#v", suite)
	}
	if suite.Cases[0].CaseID != "Case:One" || suite.Cases[0].ID != "" || suite.Cases[0].Assertions == nil {
		t.Fatalf("suite case normalization = %#v", suite.Cases[0])
	}
	if _, err := os.Stat(filepath.Join(fs.Dir(), "suites", "suite-one.json")); err != nil {
		t.Fatalf("suite file uses canonical name: %v", err)
	}

	_, err = Put(fs, Experiment{
		ID: "experiment-1",
		Suite: ExperimentSuite{
			ID: "suite-1",
		},
		Summary: ExperimentSummary{Total: 1, Passed: 1},
		Cases: []ExperimentCase{
			{
				CaseID:    "case-1",
				VariantID: "candidate",
				Status:    "passed",
				TraceID:   "trace-1",
				Scores:    []Score{{Kind: "numeric", Name: "accuracy", Value: floatPtr(0.9)}},
			},
		},
	})
	if err != nil {
		t.Fatalf("put experiment: %v", err)
	}
	comparison, err := Put(fs, Comparison{ID: "comparison-1"})
	if err != nil {
		t.Fatalf("put comparison: %v", err)
	}
	if comparison.Tag != "QualityComparison" || comparison.QualityID != "local" || comparison.Status != "ready" || comparison.ComparedAt == "" {
		t.Fatalf("comparison defaults = %#v", comparison)
	}
	baseline, err := Put(fs, Baseline{ID: "baseline-1", ExperimentID: "experiment-1"})
	if err != nil {
		t.Fatalf("put baseline: %v", err)
	}
	if baseline.Tag != "QualityBaseline" || baseline.QualityID != "local" || baseline.PromotedAt == "" {
		t.Fatalf("baseline defaults = %#v", baseline)
	}
	feedback, err := Put(fs, Feedback{TraceID: stringPtr("trace-1")})
	if err != nil {
		t.Fatalf("put feedback: %v", err)
	}
	if feedback.ID == "" || feedback.Tag != "QualityFeedback" || feedback.QualityID != "local" || feedback.CreatedAt == "" || feedback.Status != "new" {
		t.Fatalf("feedback defaults = %#v", feedback)
	}
	status, err := Put(fs, InsightStatus{InsightID: "insight-1", Status: "resolved", ResolvedOccurrences: 2})
	if err != nil {
		t.Fatalf("put insight status: %v", err)
	}
	if status.Tag != "QualityInsightStatus" || status.UpdatedAt == "" || status.ResolvedAt == "" {
		t.Fatalf("insight status defaults = %#v", status)
	}
	silence, err := Put(fs, InsightSilence{Pattern: InsightSilencePattern{Title: "  Slow run  ", TargetID: " writer "}})
	if err != nil {
		t.Fatalf("put insight silence: %v", err)
	}
	if silence.Pattern.Title != "Slow run" || silence.Pattern.TargetID != "writer" || silence.ID == "" || silence.Tag != "QualityInsightSilence" || silence.CreatedAt == "" {
		t.Fatalf("insight silence defaults = %#v", silence)
	}
	issue, err := Put(fs, CassetteIssue{Path: "missing.cassette.json", Status: "missing", Kind: "prompt", TargetID: "writer.prompt"})
	if err != nil {
		t.Fatalf("put cassette issue: %v", err)
	}
	if issue.EntryID == "" || issue.Tag != "QualityCassetteIssue" || issue.RecordedAt == "" {
		t.Fatalf("cassette issue defaults = %#v", issue)
	}

	snapshot, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snapshot.Suites) != 1 || len(snapshot.Experiments) != 1 || len(snapshot.Comparisons) != 1 || len(snapshot.Baselines) != 1 || len(snapshot.Feedback) != 1 {
		t.Fatalf("snapshot record counts: suites=%d experiments=%d comparisons=%d baselines=%d feedback=%d", len(snapshot.Suites), len(snapshot.Experiments), len(snapshot.Comparisons), len(snapshot.Baselines), len(snapshot.Feedback))
	}
	if got := snapshot.ByTrace.ExperimentIDs["trace-1"]; len(got) != 1 || got[0] != "experiment-1" {
		t.Fatalf("experiment trace join = %#v, want [experiment-1]", got)
	}
	if got := snapshot.ByTrace.Scores["trace-1"]; got.Name != "accuracy" || got.Value == nil || *got.Value != 0.9 {
		t.Fatalf("score join = %#v, want accuracy 0.9", got)
	}
	if got := snapshot.Statuses["insight-1"].Status; got != "resolved" {
		t.Fatalf("insight status = %q, want resolved", got)
	}
	if len(snapshot.Silences) != 1 {
		t.Fatalf("silence count = %d, want 1", len(snapshot.Silences))
	}
	if len(snapshot.Cassettes) != 1 || snapshot.Cassettes[0].Status != "missing" {
		t.Fatalf("cassette issue snapshot = %#v, want missing cassette", snapshot.Cassettes)
	}
}
