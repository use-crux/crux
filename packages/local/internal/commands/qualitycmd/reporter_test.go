package qualitycmd

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func forceColorProfile(t *testing.T) {
	t.Helper()
}

// variantAgg builds a one-variant aggregate with the given cell tallies and a
// pass rate, enough to drive the reporter's row + banner math.
func variantAgg(passed, failed, errored, skipped int, passRate float64) domain.QualityVariantAggregate {
	return domain.QualityVariantAggregate{
		Cells:    passed + failed + errored + skipped,
		Passed:   passed,
		Failed:   failed,
		Errored:  errored,
		Skipped:  skipped,
		PassRate: passRate,
	}
}

// evalDoneEvent assembles an eval:done event for one evaluation with a single
// "default" variant aggregate. Cells are supplied separately via cell:done.
func evalDoneEvent(id string, agg domain.QualityVariantAggregate) *domain.QualityEvent {
	return &domain.QualityEvent{
		Type:         "eval:done",
		EvaluationID: id,
		ExperimentID: "exp-" + id,
		Aggregates:   &domain.QualityAggregates{PerVariant: map[string]domain.QualityVariantAggregate{"default": agg}},
	}
}

// feed drives a sequence of events through a reporter, then renders the banner.
func feed(reporter *qualityReporter, exitCode int, events ...*domain.QualityEvent) {
	for _, ev := range events {
		reporter.handle(ev)
	}
	reporter.banner(exitCode)
}

func TestReporterColorlessInvariant(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	reporter := newQualityReporter(&qualityRunOpts{}, io, 4400)

	failing := domain.QualityCell{
		CaseID: "c2", CaseName: "rejects empty", VariantName: "default", Status: "failed",
	}
	failing.Assertions.Outcomes = []domain.QualityAssertionOutcome{{Status: "failed", Matcher: "toBe", Message: "expected non-empty"}}

	feed(reporter, 0,
		&domain.QualityEvent{Type: "collect:done", Evaluations: make([]domain.QualityManifest, 1)},
		&domain.QualityEvent{Type: "cell:done", EvaluationID: "memory.contracts", Cell: &domain.QualityCell{CaseID: "c1", Status: "passed"}},
		&domain.QualityEvent{Type: "cell:done", EvaluationID: "memory.contracts", Cell: &failing},
		evalDoneEvent("memory.contracts", variantAgg(1, 0, 0, 0, 1.0)),
	)

	stdout := out.String()
	if strings.Contains(stdout, "\x1b") {
		t.Fatalf("colorless stdout contained an ANSI escape:\n%q", stdout)
	}
	for _, want := range []string{"memory.contracts", "pass", "1 passed", "exit 0"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("colorless stdout missing %q:\n%s", want, stdout)
		}
	}
}

// lineContaining returns the first line of s that contains sub, for asserting
// color is applied to the right row.
func lineContaining(s, sub string) string {
	for _, line := range strings.Split(s, "\n") {
		if strings.Contains(line, sub) {
			return line
		}
	}
	return ""
}

func TestReporterColorPresentOnPassAndFailRows(t *testing.T) {
	forceColorProfile(t)
	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{StdoutTTY: true, ColorEnabled: true})
	reporter := newQualityReporter(&qualityRunOpts{}, io, 4400)

	failing := domain.QualityCell{CaseID: "c2", CaseName: "rejects empty", VariantName: "default", Status: "failed"}
	failing.Assertions.Outcomes = []domain.QualityAssertionOutcome{{Status: "failed", Matcher: "toBe", Message: "boom"}}

	reporter.handle(&domain.QualityEvent{Type: "cell:done", EvaluationID: "e", Cell: &failing})
	reporter.handle(evalDoneEvent("e", variantAgg(3, 0, 0, 0, 1.0)))

	stdout := out.String()
	passLine := lineContaining(stdout, "pass 1.00")
	if passLine == "" || !strings.Contains(passLine, "\x1b[") {
		t.Errorf("pass-rate row should carry an ANSI color code, got %q", passLine)
	}
	failLine := lineContaining(stdout, "rejects empty")
	if failLine == "" || !strings.Contains(failLine, "\x1b[") {
		t.Errorf("failure row should carry an ANSI color code, got %q", failLine)
	}
}

func TestCellFailureTraceHyperlink(t *testing.T) {
	failing := domain.QualityCell{CaseID: "c1", CaseName: "case one", Status: "failed", TraceIDs: []string{"abc123"}}

	t.Run("tty_emits_osc8_with_factory_port", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{StdoutTTY: true, ColorEnabled: true})
		newQualityRenderer(io, 7777).cellFailure(&failing, "  ")

		stdout := out.String()
		if !strings.Contains(stdout, "\x1b]8;;") {
			t.Errorf("TTY trace line should contain an OSC-8 hyperlink, got %q", stdout)
		}
		if !strings.Contains(stdout, "http://localhost:7777/runs/abc123") {
			t.Errorf("trace URL should use the factory port 7777, got %q", stdout)
		}
	})

	t.Run("non_tty_falls_back_to_label_and_url", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
		newQualityRenderer(io, 4400).cellFailure(&failing, "  ")

		stdout := out.String()
		if strings.Contains(stdout, "\x1b") {
			t.Errorf("non-TTY trace line must be escape-free, got %q", stdout)
		}
		if !strings.Contains(stdout, "abc123 (http://localhost:4400/runs/abc123)") {
			t.Errorf("non-TTY should fall back to 'label (url)', got %q", stdout)
		}
	})
}

// pinClock fixes the reporter's elapsed at d for a deterministic banner.
func pinClock(reporter *qualityReporter, d time.Duration) {
	base := reporter.startedAt
	reporter.nowFn = func() time.Time { return base.Add(d) }
}

func TestReporterBannerSummarizesRun(t *testing.T) {
	tests := []struct {
		name      string
		exitCode  int
		wantToken string
	}{
		{"pass", 0, "PASS"},
		{"fail", 1, "FAIL"},
		{"error", 2, "ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out, errBuf bytes.Buffer
			io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
			reporter := newQualityReporter(&qualityRunOpts{}, io, 4400)
			pinClock(reporter, 18400*time.Millisecond)

			// Two evaluations: cell tallies must sum across both, one gate fails.
			gated := evalDoneEvent("alpha", variantAgg(7, 1, 0, 2, 0.875))
			gated.Gates = &domain.QualityGates{Results: []domain.QualityGateResult{{Gate: "pass_rate", Passed: false}}}
			reporter.handle(gated)
			reporter.handle(evalDoneEvent("beta", variantAgg(5, 0, 0, 1, 1.0)))

			reporter.banner(tt.exitCode)
			stdout := out.String()

			for _, want := range []string{
				tt.wantToken,
				"12 passed", "1 failed", "0 errored", "3 skipped",
				"2 evaluations", "1 gates failed", "18.4s",
			} {
				if !strings.Contains(stdout, want) {
					t.Errorf("banner missing %q:\n%s", want, stdout)
				}
			}
		})
	}
}
