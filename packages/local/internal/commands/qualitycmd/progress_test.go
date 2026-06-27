package qualitycmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// progressIO builds a test IO with the given stderr-TTY/CI capabilities. Color
// is on so the absence of escapes in plain output proves the strategy, not a
// disabled palette.
func progressIO(out, errBuf *bytes.Buffer, stderrTTY, ci bool) *output.IO {
	return output.NewTestIO(out, errBuf, output.TestIOOptions{
		StdoutTTY:    true,
		StderrTTY:    stderrTTY,
		ColorEnabled: true,
		CI:           ci,
	})
}

func TestUseLiveProgressSelection(t *testing.T) {
	tests := []struct {
		name      string
		stderrTTY bool
		ci        bool // io.IsCI()
		optCI     bool // --ci
		quiet     bool // --quiet
		want      bool
	}{
		{"tty_interactive", true, false, false, false, true},
		{"not_a_tty", false, false, false, false, false},
		{"ci_env", true, true, false, false, false},
		{"ci_flag", true, false, true, false, false},
		{"quiet", true, false, false, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out, errBuf bytes.Buffer
			io := progressIO(&out, &errBuf, tt.stderrTTY, tt.ci)
			opts := &qualityRunOpts{ci: tt.optCI, quiet: tt.quiet}
			if got := useLiveProgress(io, opts); got != tt.want {
				t.Errorf("useLiveProgress = %v, want %v", got, tt.want)
			}
		})
	}
}

// drainProgress feeds a small live run through a progress strategy: start,
// collect, one eval of two cells (one pass, one fail), then clear.
func drainProgress(p runProgress) {
	p.start()
	p.collected(1)
	p.evalStart("memory.contracts", 2)
	p.cellStart("memory.contracts")
	p.cellDone(&domain.QualityCell{CaseID: "c1", Status: "passed"})
	p.cellStart("memory.contracts")
	p.cellDone(&domain.QualityCell{CaseID: "c2", Status: "failed"})
	p.clear()
}

func TestPlainProgressHasNoCarriageReturns(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := progressIO(&out, &errBuf, false, false)
	drainProgress(newPlainProgress(io, &qualityRunOpts{verbose: true}))

	if strings.Contains(errBuf.String(), "\r") {
		t.Errorf("plain progress must never write a carriage return:\n%q", errBuf.String())
	}
	if strings.Contains(out.String(), "\r") {
		t.Errorf("plain progress must not touch stdout with control bytes:\n%q", out.String())
	}
	// CI-visible per-eval line.
	if !strings.Contains(errBuf.String(), "memory.contracts") {
		t.Errorf("plain progress should announce the evaluation:\n%q", errBuf.String())
	}
}

func TestLiveProgressRedrawsCounterInPlace(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := progressIO(&out, &errBuf, true, false)
	drainProgress(newLiveProgress(io, func() float64 { return 0 }))

	stderr := errBuf.String()
	if !strings.Contains(stderr, "\r") {
		t.Errorf("live progress should redraw in place with a carriage return:\n%q", stderr)
	}
	if !strings.Contains(stderr, "1/2") {
		t.Errorf("live progress should show a running done/total counter:\n%q", stderr)
	}
	if out.Len() != 0 {
		t.Errorf("live progress must stay off stdout, got:\n%q", out.String())
	}
}

func TestCIFlagForcesPlainOnATTY(t *testing.T) {
	var out, errBuf bytes.Buffer
	io := progressIO(&out, &errBuf, true, false) // a real TTY …
	reporter := newQualityReporter(&qualityRunOpts{ci: true}, io, 4400)

	if _, ok := reporter.progress.(*liveProgress); ok {
		t.Fatal("--ci must select the plain reporter even on a TTY")
	}
	// Drive a tiny run; nothing on stderr may carry a carriage return …
	reporter.handle(&domain.QualityEvent{Type: "eval:start", EvaluationID: "e", Cells: 1})
	reporter.handle(&domain.QualityEvent{Type: "cell:done", EvaluationID: "e", Cell: &domain.QualityCell{CaseID: "c1", Status: "passed"}})
	reporter.handle(evalDoneEvent("e", variantAgg(1, 0, 0, 0, 1.0)))
	reporter.banner(0)

	if strings.Contains(errBuf.String(), "\r") {
		t.Errorf("--ci output must not animate (no \\r):\n%q", errBuf.String())
	}
	// … and --ci forces color off, so stdout stays escape-free even on a TTY.
	if strings.Contains(out.String(), "\x1b") {
		t.Errorf("--ci must force color off; stdout had an escape:\n%q", out.String())
	}
}
