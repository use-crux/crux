package qualitycmd

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// forceAsciiProfile pins lipgloss's global color profile to Ascii for a test so
// the colorless invariant holds regardless of the host's detected profile (the
// progress table styles its header/separator through lipgloss directly).
func forceAsciiProfile(t *testing.T) {
	t.Helper()
	prev := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.Ascii)
	t.Cleanup(func() { lipgloss.SetColorProfile(prev) })
}

func f64(v float64) *float64 { return &v }

// fixedClock returns a nowFn pinned to the given RFC3339 instant.
func fixedClock(t *testing.T, rfc3339 string) func() time.Time {
	t.Helper()
	now, err := time.Parse(time.RFC3339, rfc3339)
	if err != nil {
		t.Fatalf("bad fixed clock %q: %v", rfc3339, err)
	}
	return func() time.Time { return now }
}

func progressFixture() api.QualityEvaluationProgress {
	return api.QualityEvaluationProgress{
		EvaluationID: "memory.contracts",
		Runs: []api.QualityEvaluationProgressRun{
			{ExperimentID: "exp_91c2", StartedAt: "2026-06-16T10:00:00Z", FinishedAt: "2026-06-16T10:00:00Z", Verdict: "passed", PassRate: 0.92, CostUsd: f64(0.04)},
			{ExperimentID: "exp_8f3a", StartedAt: "2026-06-16T07:00:00Z", FinishedAt: "2026-06-16T07:00:00Z", Verdict: "failed", PassRate: 0.87, CostUsd: f64(0.04)},
		},
		ScoreSeries: []api.QualityScoreProgressSeries{
			{ScoreName: "pii_removed", Baseline: &api.QualityScoreProgressBaseline{Value: 0.9, BaselineID: "bsl_aaa"}},
		},
	}
}

func TestProgressRendererColorlessFieldsAndDeltas(t *testing.T) {
	forceAsciiProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	r := newProgressRenderer(io)
	r.nowFn = fixedClock(t, "2026-06-16T12:00:00Z")

	r.render(io.Out, progressFixture())
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless progress output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{
		"memory.contracts",
		"2 runs · latest 2h ago · baseline bsl_aaa",
		"when", "experiment", "pass", "cost", "Δ pass",
		"2h ago", "exp_91c2", "0.92", "$0.04", "+0.05 ▲",
		"5h ago", "exp_8f3a", "0.87", "—",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("progress output missing %q:\n%s", want, got)
		}
	}
}

func TestProgressRendererOmitsBaselineWhenAbsent(t *testing.T) {
	forceAsciiProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	r := newProgressRenderer(io)
	r.nowFn = fixedClock(t, "2026-06-16T12:00:00Z")

	p := progressFixture()
	p.ScoreSeries = nil // no promoted baseline
	r.render(io.Out, p)
	got := out.String()

	if strings.Contains(got, "baseline") {
		t.Errorf("summary must omit the baseline clause when none is promoted:\n%s", got)
	}
	if strings.Contains(got, "<nil>") {
		t.Errorf("output must not leak <nil>:\n%s", got)
	}
}

func TestProgressRendererHandlesNoRuns(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	r := newProgressRenderer(io)

	r.render(io.Out, api.QualityEvaluationProgress{EvaluationID: "memory.contracts"})
	got := out.String()

	if !strings.Contains(got, "memory.contracts") || !strings.Contains(got, "no runs recorded yet") {
		t.Errorf("empty progress should print a header and an honest empty line:\n%s", got)
	}
}

func cellEvidenceFixture() api.QualityCellEvidence {
	return api.QualityCellEvidence{
		ExperimentID: "exp_91c2",
		Cell: api.QualityCellIdentity{
			CaseID: "strips-pii", VariantName: "default", Trial: 0, Status: "failed",
			DurationMs: 1800, CostUsd: f64(0.0042),
			CapturedSignals: []string{"latency"},
			TraceIDs:        []string{"abc123"},
		},
		Scores: []api.QualityScoreEvidence{
			{Name: "pii_removed", Score: 0.0, Threshold: &api.QualityScoreThreshold{Source: "gate", Operator: "gte", Value: 1, Passed: false}},
			{Name: "latency_ok", Score: 1.0},
		},
		Assertions: api.QualityAssertionEvidence{
			Ran: 3,
			Outcomes: []api.QualityAssertionOutcome{
				{
					Matcher: "toContainRedaction", Status: "failed",
					Expected:  &api.QualityAssertionValue{Preview: `"[REDACTED]" present`},
					Actual:    &api.QualityAssertionValue{Preview: `"john@acme.com"`},
					SourceRef: "memory/contracts.eval.ts:42",
				},
				{Matcher: "latency", Status: "passed"},
			},
		},
	}
}

func TestCellEvidenceRendererColorlessSections(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	newCellEvidenceRenderer(io, 4400).render(io.Out, cellEvidenceFixture())
	got := out.String()

	if strings.Contains(got, "\x1b") {
		t.Fatalf("colorless cell-evidence output contained an ANSI escape:\n%q", got)
	}
	for _, want := range []string{
		"exp_91c2",
		"case strips-pii / variant default / trial 0",
		"failed", "1.8s", "$0.0042",
		"Scores", "pii_removed", "0.00", "(expected ≥ 1.00)", "latency_ok",
		"Assertions", "3 ran · 1 failed",
		"toContainRedaction", "Expected:", `"[REDACTED]" present`, "Received:", `"john@acme.com"`,
		"at memory/contracts.eval.ts:42",
		"Signals", "latency",
		"Trace", "abc123",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("cell-evidence output missing %q:\n%s", want, got)
		}
	}
}

func TestCellEvidenceRendererErrorBlock(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	e := cellEvidenceFixture()
	e.Cell.Status = "errored"
	e.Cell.Error = &api.QualityCellError{
		Phase: "replay", Message: "no cassette entry", MissingCassetteKey: "strips-pii::default",
	}
	newCellEvidenceRenderer(io, 4400).render(io.Out, e)
	got := out.String()

	for _, want := range []string{
		"Error", "(replay)", "no cassette entry",
		"missing cassette key: strips-pii::default",
		"re-record with: crux quality run strips-pii --replay record-new",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("error block missing %q:\n%s", want, got)
		}
	}
}

func TestCellEvidenceRendererOmitsAbsentSections(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

	e := api.QualityCellEvidence{
		ExperimentID: "exp_zero",
		Cell: api.QualityCellIdentity{
			CaseID: "c1", VariantName: "default", Trial: 0, Status: "passed", DurationMs: 500,
		},
	}
	newCellEvidenceRenderer(io, 4400).render(io.Out, e)
	got := out.String()

	for _, absent := range []string{"Scores", "Assertions", "Error", "Signals", "Trace", "<nil>"} {
		if strings.Contains(got, absent) {
			t.Errorf("absent-data evidence should omit %q:\n%s", absent, got)
		}
	}
}

func TestCellEvidenceTraceHyperlinkUsesFactoryPort(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{StdoutTTY: true, ColorEnabled: true})
	newCellEvidenceRenderer(io, 7777).render(io.Out, cellEvidenceFixture())
	got := out.String()

	if !strings.Contains(got, "\x1b]8;;") {
		t.Errorf("TTY trace line should carry an OSC-8 hyperlink:\n%q", got)
	}
	if !strings.Contains(got, "http://localhost:7777/runs/abc123") {
		t.Errorf("trace URL should use the factory port 7777:\n%q", got)
	}
}
